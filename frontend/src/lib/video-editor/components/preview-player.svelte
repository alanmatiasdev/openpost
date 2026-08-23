<!-- Multi-track composited preview with direct transform gizmos. -->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import type {
		ItemTransform,
		KeyframeProperty,
		TimelineItem
	} from '$lib/video-editor/project/types';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { getMediaObjectUrl, revokeMediaObjectUrl } from '$lib/video-editor/media/media-source';
	import { paintOrder } from '$lib/video-editor/media/render-plan';
	import { resolveAnimatedItemAt } from '$lib/video-editor/timeline/animated-properties';
	import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
	import { setAnimatedProperties } from '$lib/video-editor/timeline/actions/keyframes';
	import {
		incomingOpacity,
		outgoingOpacity,
		transitionsStore,
		transitionAtFrame
	} from '$lib/video-editor/timeline/actions/transitions.svelte';
	import PreviewLayer from './preview-layer.svelte';
	import PreviewAudioLayer from './preview-audio-layer.svelte';
	import { previewPlaybackSettings } from '$lib/video-editor/preview/playback-settings.svelte';
	import {
		collectAdjustmentLayers,
		effectsForItemAtFrame
	} from '$lib/video-editor/effects/adjustment-layers';
	import { isNonNormalBlend } from '$lib/video-editor/effects/gpu/blend-modes';
	import {
		CanvasStackCompositor,
		itemOpacity
	} from '$lib/video-editor/media/canvas-stack-compositor';
	import { scaleItemForCanvas } from '$lib/video-editor/media/render-geometry';
	import type {
		PreviewSourceProvider,
		RegisterPreviewSource
	} from '$lib/video-editor/preview/source-provider';

	const MAX_STACK_PREVIEW_PIXELS = 1920 * 1080;

	let {
		selectedItemId = $bindable(null),
		onedit
	}: { selectedItemId?: string | null; onedit: () => void } = $props();
	const project = $derived(editorSession.project);
	const canvasWidth = $derived(project?.metadata.width ?? 1920);
	const canvasHeight = $derived(project?.metadata.height ?? 1080);
	const aspect = $derived(`${canvasWidth} / ${canvasHeight}`);
	let urls = $state<Record<string, string>>({});
	let viewport = $state<HTMLDivElement | null>(null);
	let draftTransform = $state<ItemTransform | null>(null);
	let stackCanvas = $state<HTMLCanvasElement | null>(null);
	let stackCompositor = $state<CanvasStackCompositor | null>(null);
	let stackWidth = $state(1);
	let stackHeight = $state(1);
	let stackFrameRequest: number | null = null;
	let pendingStackInputs: {
		items: TimelineItem[];
		layers: typeof adjustmentLayers;
		orders: typeof trackOrderById;
		width: number;
		height: number;
	} | null = null;
	const sourceProviders = new Map<string, PreviewSourceProvider>();
	const activeTransition = $derived.by(() => {
		for (const transition of transitionsStore.list) {
			const state = transitionAtFrame(transition, timelineStore.currentFrame, editorSession.fps);
			if (state) return state;
		}
		return null;
	});
	const activeItems = $derived.by(() =>
		paintOrder(timelineStore.items, timelineStore.tracks).filter(
			(item) =>
				['video', 'image', 'text', 'subtitle'].includes(item.type) &&
				((timelineStore.currentFrame >= item.from &&
					timelineStore.currentFrame < item.from + item.durationInFrames) ||
					item.id === activeTransition?.outgoing ||
					item.id === activeTransition?.incoming)
		)
	);
	const trackOrderById = $derived(
		new Map(timelineStore.tracks.map((track) => [track.id, track.order]))
	);
	const adjustmentLayers = $derived(
		collectAdjustmentLayers(timelineStore.items, timelineStore.tracks)
	);
	const needsStackedComposition = $derived(
		activeItems.some(
			(item) =>
				isNonNormalBlend(item.blendMode) &&
				(resolveAnimatedItemAt(item, timelineStore.currentFrame).transform?.opacity ?? 1) > 0
		)
	);
	const selectedItem = $derived(
		selectedItemId ? activeItems.find((item) => item.id === selectedItemId) : undefined
	);
	const selectedResolved = $derived(
		selectedItem ? resolveAnimatedItemAt(selectedItem, timelineStore.currentFrame) : undefined
	);
	const selectedTrackLocked = $derived(
		selectedItem
			? (timelineStore.tracks.find((track) => track.id === selectedItem.trackId)?.locked ?? false)
			: false
	);

	$effect(() => {
		for (const media of mediaPool.mediaList) {
			if (urls[media.id]) continue;
			void getMediaObjectUrl(media)
				.then((url) => {
					urls = { ...urls, [media.id]: url };
				})
				.catch(() => undefined);
		}
	});

	onDestroy(() => {
		if (stackFrameRequest !== null) cancelAnimationFrame(stackFrameRequest);
		stackFrameRequest = null;
		for (const id of Object.keys(urls)) revokeMediaObjectUrl(id);
	});

	function transitionOpacity(item: TimelineItem): number {
		const state = activeTransition;
		if (state?.outgoing === item.id) return outgoingOpacity(state.type, state.progress);
		if (state?.incoming === item.id) return incomingOpacity(state.type, state.progress);
		return 1;
	}

	function effectiveEffects(
		item: TimelineItem,
		layers = adjustmentLayers,
		orders = trackOrderById,
		frame = timelineStore.currentFrame
	) {
		return effectsForItemAtFrame(item, orders.get(item.trackId) ?? 0, layers, frame);
	}

	const registerPreviewSource: RegisterPreviewSource = (itemId, provider) => {
		if (provider) sourceProviders.set(itemId, provider);
		else sourceProviders.delete(itemId);
		scheduleStackFrame();
	};

	function scheduleStackFrame(): void {
		if (!needsStackedComposition) return;
		pendingStackInputs = {
			items: activeItems,
			layers: adjustmentLayers,
			orders: trackOrderById,
			width: stackWidth,
			height: stackHeight
		};
		if (stackFrameRequest !== null) return;
		stackFrameRequest = requestAnimationFrame(() => {
			stackFrameRequest = null;
			renderStackFrame();
		});
	}

	function renderStackFrame(): void {
		const stack = stackCompositor;
		const projectState = project;
		const inputs = pendingStackInputs;
		if (!stack || !projectState || !inputs || !needsStackedComposition) return;
		stack.beginFrame(
			inputs.width,
			inputs.height,
			projectState.metadata.backgroundColor ?? '#000000'
		);
		const frame = timelineStore.currentFrame;
		for (const item of inputs.items) {
			const source = sourceProviders.get(item.id)?.();
			if (!source) continue;
			const resolved = scaleItemForCanvas(
				resolveAnimatedItemAt(item, frame),
				inputs.width / canvasWidth,
				inputs.height / canvasHeight
			);
			resolved.effects = effectiveEffects(item, inputs.layers, inputs.orders, frame);
			const alpha = itemOpacity(resolved) * transitionOpacity(item);
			if (alpha <= 0) continue;
			stack.compositeLayer(source, resolved, alpha, frame / editorSession.fps);
		}
	}

	$effect(() => {
		const node = viewport;
		if (!node) return;
		const updateSize = () => {
			const rect = node.getBoundingClientRect();
			const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
			const scale = Math.min(
				1,
				Math.max(1, rect.width * pixelRatio) / canvasWidth,
				Math.max(1, rect.height * pixelRatio) / canvasHeight
			);
			let nextWidth = Math.max(1, Math.round(canvasWidth * scale));
			let nextHeight = Math.max(1, Math.round(canvasHeight * scale));
			const pixelCount = nextWidth * nextHeight;
			if (pixelCount > MAX_STACK_PREVIEW_PIXELS) {
				const reduction = Math.sqrt(MAX_STACK_PREVIEW_PIXELS / pixelCount);
				nextWidth = Math.max(1, Math.round(nextWidth * reduction));
				nextHeight = Math.max(1, Math.round(nextHeight * reduction));
			}
			stackWidth = nextWidth;
			stackHeight = nextHeight;
			scheduleStackFrame();
		};
		const observer = new ResizeObserver(updateSize);
		observer.observe(node);
		updateSize();
		return () => observer.disconnect();
	});

	$effect(() => {
		const canvas = stackCanvas;
		if (!canvas || !needsStackedComposition) return;
		const stack = new CanvasStackCompositor(canvas);
		stackCompositor = stack;
		scheduleStackFrame();
		return () => {
			stack.dispose();
			if (stackCompositor === stack) stackCompositor = null;
		};
	});

	$effect(() => {
		if (!needsStackedComposition) return;
		scheduleStackFrame();
		const offFrame = editorSession.clock.on('framechange', scheduleStackFrame);
		const offPlay = editorSession.clock.on('play', scheduleStackFrame);
		return () => {
			offFrame();
			offPlay();
		};
	});

	function startGizmo(event: PointerEvent, mode: 'move' | 'resize'): void {
		if (!selectedItem || !viewport) return;
		event.preventDefault();
		event.stopPropagation();
		const startX = event.clientX;
		const startY = event.clientY;
		const base = { ...(selectedResolved?.transform ?? {}) };
		const rect = viewport.getBoundingClientRect();
		const scaleX = canvasWidth / rect.width;
		const scaleY = canvasHeight / rect.height;
		const move = (next: PointerEvent) => {
			const dx = (next.clientX - startX) * scaleX;
			const dy = (next.clientY - startY) * scaleY;
			draftTransform =
				mode === 'move'
					? { ...base, x: (base.x ?? 0) + dx, y: (base.y ?? 0) + dy }
					: {
							...base,
							width: Math.max(16, (base.width ?? canvasWidth) + dx),
							height: Math.max(16, (base.height ?? canvasHeight) + dy)
						};
		};
		const end = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', end);
			if (draftTransform && selectedItemId) {
				const values =
					mode === 'move'
						? { x: draftTransform.x, y: draftTransform.y }
						: { width: draftTransform.width, height: draftTransform.height };
				setAnimatedProperties(
					selectedItemId,
					timelineStore.currentFrame,
					values,
					(property: KeyframeProperty) =>
						autoKeyframeStore.isEnabled(selectedItemId ?? '', property)
				);
				onedit();
			}
			draftTransform = null;
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', end, { once: true });
	}
</script>

<div
	class="fullscreen:p-6 [container-type:size] flex min-h-0 flex-1 overflow-auto bg-[oklch(0.12_0.008_55)] p-4"
>
	<div
		bind:this={viewport}
		class="[container-type:size] relative m-auto shrink-0 overflow-hidden rounded-md bg-black"
		style={previewPlaybackSettings.zoom === -1
			? `aspect-ratio:${aspect}; width:min(100cqw, calc(100cqh * ${canvasWidth / canvasHeight})); max-width:100%; max-height:100%;`
			: `aspect-ratio:${aspect}; width:${canvasWidth * previewPlaybackSettings.zoom}px;`}
	>
		{#if activeItems.length === 0}
			<div
				class="flex size-full min-h-48 min-w-80 items-center justify-center border border-dashed border-[oklch(0.3_0.01_55)] text-xs text-[oklch(0.65_0.015_55)]"
			>
				{m.video_editor_preview_empty()}
			</div>
		{:else}
			{#if needsStackedComposition}
				<div class="absolute inset-0" role="img" aria-label={m.video_editor_preview_suggestion()}>
					<canvas
						bind:this={stackCanvas}
						width={stackWidth}
						height={stackHeight}
						class="size-full object-fill"
						aria-hidden="true"
						data-stacked-preview
					></canvas>
				</div>
			{/if}
			{#each activeItems as item (item.id)}
				<PreviewLayer
					{item}
					url={urls[item.mediaId ?? '']}
					{canvasWidth}
					{canvasHeight}
					effectiveEffects={effectiveEffects(item)}
					deferEffects={needsStackedComposition}
					registersource={registerPreviewSource}
					onsourcechange={scheduleStackFrame}
					selected={item.id === selectedItemId}
					opacityMultiplier={transitionOpacity(item)}
					overrideTransform={item.id === selectedItemId ? (draftTransform ?? undefined) : undefined}
					onselect={() => (selectedItemId = item.id)}
				/>
			{/each}
			{#if selectedResolved && !selectedTrackLocked}
				{@const transform = draftTransform ?? selectedResolved.transform ?? {}}
				{@const width = transform.width ?? canvasWidth}
				{@const height = transform.height ?? canvasHeight}
				<div
					role="presentation"
					class="absolute cursor-move border border-[oklch(0.72_0.16_45)] shadow-[0_0_0_1px_black]"
					style:left={`${50 + ((transform.x ?? 0) / canvasWidth) * 100}%`}
					style:top={`${50 + ((transform.y ?? 0) / canvasHeight) * 100}%`}
					style:width={`${(width / canvasWidth) * 100}%`}
					style:height={`${(height / canvasHeight) * 100}%`}
					style:transform={`translate(-50%, -50%) rotate(${transform.rotation ?? 0}deg)`}
					onpointerdown={(event) => startGizmo(event, 'move')}
				>
					<button
						type="button"
						class="absolute -right-2 -bottom-2 size-4 cursor-nwse-resize rounded-full border border-black bg-[oklch(0.72_0.16_45)] focus-visible:outline-2 focus-visible:outline-white"
						aria-label={m.video_editor_preview_resize_selected()}
						onpointerdown={(event) => startGizmo(event, 'resize')}
					></button>
				</div>
			{/if}
		{/if}
	</div>
	{#each timelineStore.items.filter((item) => item.type === 'audio' && timelineStore.currentFrame >= item.from && timelineStore.currentFrame < item.from + item.durationInFrames) as item (item.id)}
		<PreviewAudioLayer {item} url={urls[item.mediaId ?? '']} />
	{/each}
</div>
