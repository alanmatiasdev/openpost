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
	import { setPositionAtFrame } from '$lib/video-editor/timeline/actions/keyframes';
	import { setCurrentFrame, updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import {
		incomingOpacity,
		outgoingOpacity,
		transitionsStore,
		transitionAtFrame
	} from '$lib/video-editor/timeline/actions/transitions.svelte';
	import PreviewLayer from './preview-layer.svelte';
	import PreviewAudioLayer from './preview-audio-layer.svelte';
	import OnCanvasTools from './on-canvas-tools.svelte';
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
	import { colorPreviewStore } from '$lib/video-editor/effects/color-preview-store.svelte';
	import { withoutColorGradeEffects } from '$lib/video-editor/effects/color-grade';
	import { scopeSamples } from '$lib/video-editor/effects/scope-samples.svelte';
	import { toast } from 'svelte-sonner';

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
	let draftCrop = $state<NonNullable<TimelineItem['crop']> | null>(null);
	let draftText = $state<string | null>(null);
	let editingText = $state(false);
	let isPlaying = $state(editorSession.clock.isPlaying);
	let stackCanvas = $state<HTMLCanvasElement | null>(null);
	let stackCompositor = $state<CanvasStackCompositor | null>(null);
	let compareCanvas = $state<HTMLCanvasElement | null>(null);
	let compareCompositor = $state<CanvasStackCompositor | null>(null);
	let stackWidth = $state(1);
	let stackHeight = $state(1);
	let pickerOverlay = $state<HTMLButtonElement | null>(null);
	let pickerLoupe = $state<HTMLCanvasElement | null>(null);
	let pickerX = $state(0);
	let pickerY = $state(0);
	let pickerColor = $state<{ r: number; g: number; b: number } | null>(null);
	let lastStackScopeAt = 0;
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
		colorPreviewStore.comparisonMode !== 'after' ||
			colorPreviewStore.activePicker !== null ||
			colorPreviewStore.frameCaptureItemId !== null ||
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

	$effect(() => {
		const sync = () => (isPlaying = editorSession.clock.isPlaying);
		const offPlay = editorSession.clock.on('play', sync);
		const offPause = editorSession.clock.on('pause', sync);
		return () => {
			offPlay();
			offPause();
		};
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
		const compare = compareCompositor;
		const projectState = project;
		const inputs = pendingStackInputs;
		if (!stack || !projectState || !inputs || !needsStackedComposition) return;
		stack.beginFrame(
			inputs.width,
			inputs.height,
			projectState.metadata.backgroundColor ?? '#000000'
		);
		const comparisonMode = colorPreviewStore.comparisonMode;
		if (comparisonMode === 'split' && compare) {
			compare.beginFrame(
				inputs.width,
				inputs.height,
				projectState.metadata.backgroundColor ?? '#000000'
			);
		}
		const frame = timelineStore.currentFrame;
		for (const item of inputs.items) {
			const source = sourceProviders.get(item.id)?.();
			if (!source) continue;
			const baseResolved = resolveAnimatedItemAt(item, frame);
			const directDraft = item.id === selectedItemId;
			const resolved = scaleItemForCanvas(
				{
					...baseResolved,
					transform: directDraft
						? (draftTransform ?? baseResolved.transform)
						: baseResolved.transform,
					crop: directDraft ? (draftCrop ?? baseResolved.crop) : baseResolved.crop,
					text: directDraft ? (draftText ?? baseResolved.text) : baseResolved.text
				},
				inputs.width / canvasWidth,
				inputs.height / canvasHeight
			);
			const afterEffects = effectiveEffects(item, inputs.layers, inputs.orders, frame);
			resolved.effects =
				comparisonMode === 'before' ? withoutColorGradeEffects(afterEffects) : afterEffects;
			const alpha = itemOpacity(resolved) * transitionOpacity(item);
			if (alpha <= 0) continue;
			stack.compositeLayer(source, resolved, alpha, frame / editorSession.fps);
			if (comparisonMode === 'split' && compare) {
				compare.compositeLayer(
					source,
					{ ...resolved, effects: withoutColorGradeEffects(afterEffects) },
					alpha,
					frame / editorSession.fps
				);
			}
		}
		publishStackScope(stackCanvas);
	}

	function publishStackScope(canvas: HTMLCanvasElement | null): void {
		if (!canvas || !selectedItemId) return;
		const now = performance.now();
		const captureRequested = colorPreviewStore.frameCaptureItemId === selectedItemId;
		if (!captureRequested && now - lastStackScopeAt < 200) return;
		lastStackScopeAt = now;
		const sample = new OffscreenCanvas(256, 144);
		const context = sample.getContext('2d', { willReadFrequently: true });
		if (!context) return;
		try {
			context.drawImage(canvas, 0, 0, 256, 144);
			const image = context.getImageData(0, 0, 256, 144);
			scopeSamples.publish(selectedItemId, image);
			colorPreviewStore.resolveFrameCapture(selectedItemId, image);
		} catch {
			scopeSamples.clear(selectedItemId);
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
		const canvas = compareCanvas;
		if (!canvas || colorPreviewStore.comparisonMode !== 'split') return;
		const stack = new CanvasStackCompositor(canvas);
		compareCompositor = stack;
		scheduleStackFrame();
		return () => {
			stack.dispose();
			if (compareCompositor === stack) compareCompositor = null;
		};
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

	$effect(() => {
		const picker = colorPreviewStore.activePicker;
		if (!picker) {
			pickerColor = null;
			return;
		}
		requestAnimationFrame(() => pickerOverlay?.focus());
	});

	$effect(() => {
		const captureItemId = colorPreviewStore.frameCaptureItemId;
		if (captureItemId) scheduleStackFrame();
	});

	function setSplitFromClientX(clientX: number): void {
		if (!viewport) return;
		const rect = viewport.getBoundingClientRect();
		if (rect.width <= 0) return;
		colorPreviewStore.setSplitPosition((clientX - rect.left) / rect.width);
	}

	function startSplitDrag(event: PointerEvent): void {
		event.preventDefault();
		event.stopPropagation();
		if (event.currentTarget instanceof HTMLButtonElement) {
			event.currentTarget.setPointerCapture?.(event.pointerId);
		}
		setSplitFromClientX(event.clientX);
	}

	function moveSplit(event: PointerEvent): void {
		if (event.buttons !== 1) return;
		setSplitFromClientX(event.clientX);
	}

	function splitKeydown(event: KeyboardEvent): void {
		let next: number | null = null;
		if (event.key === 'ArrowLeft')
			next = colorPreviewStore.splitPosition - (event.shiftKey ? 0.1 : 0.01);
		if (event.key === 'ArrowRight')
			next = colorPreviewStore.splitPosition + (event.shiftKey ? 0.1 : 0.01);
		if (event.key === 'Home') next = 0.05;
		if (event.key === 'End') next = 0.95;
		if (next === null) return;
		event.preventDefault();
		colorPreviewStore.setSplitPosition(next);
	}

	function samplePicker(event: PointerEvent): { r: number; g: number; b: number } | null {
		const active = scopeSamples.current;
		if (!viewport || !active || active.itemId !== selectedItemId) return null;
		const rect = viewport.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return null;
		const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
		const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
		const pixelX = Math.min(active.image.width - 1, Math.floor(x * active.image.width));
		const pixelY = Math.min(active.image.height - 1, Math.floor(y * active.image.height));
		const offset = (pixelY * active.image.width + pixelX) * 4;
		const color = {
			r: (active.image.data[offset] ?? 0) / 255,
			g: (active.image.data[offset + 1] ?? 0) / 255,
			b: (active.image.data[offset + 2] ?? 0) / 255
		};
		pickerColor = color;
		pickerX = Math.max(8, Math.min(rect.width - 88, event.clientX - rect.left + 16));
		pickerY = Math.max(8, Math.min(rect.height - 104, event.clientY - rect.top + 16));
		requestAnimationFrame(() => drawPickerLoupe(active.image, pixelX, pixelY));
		return color;
	}

	function drawPickerLoupe(image: ImageData, x: number, y: number): void {
		const loupe = pickerLoupe;
		if (!loupe) return;
		const source = document.createElement('canvas');
		source.width = image.width;
		source.height = image.height;
		source.getContext('2d')?.putImageData(image, 0, 0);
		const context = loupe.getContext('2d');
		if (!context) return;
		context.imageSmoothingEnabled = false;
		context.clearRect(0, 0, loupe.width, loupe.height);
		context.drawImage(source, x - 4, y - 4, 9, 9, 0, 0, loupe.width, loupe.height);
		context.strokeStyle = 'rgba(255,255,255,0.9)';
		context.lineWidth = 1;
		context.strokeRect(32.5, 32.5, 8, 8);
	}

	function choosePickerColor(event: PointerEvent): void {
		const color = samplePicker(event);
		if (color) colorPreviewStore.resolvePick(color);
	}

	function pickerKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			colorPreviewStore.cancelPick();
		}
	}

	function colorHex(color: { r: number; g: number; b: number }): string {
		return `#${[color.r, color.g, color.b]
			.map((channel) =>
				Math.round(channel * 255)
					.toString(16)
					.padStart(2, '0')
			)
			.join('')}`.toUpperCase();
	}

	function commitCanvasValues(
		frame: number,
		values: Partial<Record<KeyframeProperty, number>>
	): boolean {
		if (!selectedItemId) return false;
		const committed = setAnimatedProperties(selectedItemId, frame, values, (property) =>
			autoKeyframeStore.isEnabled(selectedItemId ?? '', property)
		);
		if (!committed) toast.error(m.video_editor_keyframe_transition_blocked());
		return committed;
	}

	function commitCanvasPosition(frame: number, x: number, y: number): boolean {
		const committed = selectedItemId ? setPositionAtFrame(selectedItemId, frame, x, y) : false;
		if (!committed) toast.error(m.video_editor_keyframe_transition_blocked());
		return committed;
	}

	function commitCanvasText(text: string): void {
		if (!selectedItemId || !selectedItem) return;
		updateItemProperties(
			selectedItemId,
			{ text, label: text.slice(0, 48) || selectedItem.label },
			'UPDATE_TEXT_ON_CANVAS'
		);
	}

	$effect(() => {
		void draftTransform;
		void draftCrop;
		void draftText;
		if (needsStackedComposition) scheduleStackFrame();
	});
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
					{#if colorPreviewStore.comparisonMode === 'split'}
						<canvas
							bind:this={compareCanvas}
							width={stackWidth}
							height={stackHeight}
							class="absolute inset-0 size-full object-fill"
							style:clip-path={`inset(0 ${100 - colorPreviewStore.splitPosition * 100}% 0 0)`}
							aria-hidden="true"
							data-color-before-preview
						></canvas>
						<span
							class="absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white"
							>{m.video_editor_color_before()}</span
						>
						<span
							class="absolute top-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white"
							>{m.video_editor_color_after()}</span
						>
						<button
							type="button"
							role="slider"
							class="absolute top-0 z-10 h-full w-3 -translate-x-1/2 cursor-ew-resize focus-visible:outline-2 focus-visible:outline-white"
							style:left={`${colorPreviewStore.splitPosition * 100}%`}
							aria-label={m.video_editor_color_split_position()}
							aria-valuemin="5"
							aria-valuemax="95"
							aria-valuenow={Math.round(colorPreviewStore.splitPosition * 100)}
							onpointerdown={startSplitDrag}
							onpointermove={moveSplit}
							onkeydown={splitKeydown}
						>
							<span class="mx-auto block h-full w-px bg-white shadow-[0_0_0_1px_black]"></span>
							<span
								class="absolute top-1/2 left-1/2 size-3 -translate-1/2 rounded-full border border-black bg-white"
							></span>
						</button>
					{/if}
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
					overrideCrop={item.id === selectedItemId ? (draftCrop ?? undefined) : undefined}
					overrideText={item.id === selectedItemId ? (draftText ?? undefined) : undefined}
					hideContent={item.id === selectedItemId && editingText}
					onselect={() => (selectedItemId = item.id)}
				/>
			{/each}
			{#if selectedResolved && !selectedTrackLocked}
				<OnCanvasTools
					item={selectedResolved}
					{canvasWidth}
					{canvasHeight}
					currentFrame={timelineStore.currentFrame}
					{isPlaying}
					ontransformdraft={(value) => (draftTransform = value)}
					oncropdraft={(value) => (draftCrop = value)}
					ontextdraft={(value) => (draftText = value)}
					ontextediting={(value) => (editingText = value)}
					oncommitvalues={commitCanvasValues}
					oncommitposition={commitCanvasPosition}
					oncommittext={commitCanvasText}
					onseek={setCurrentFrame}
					{onedit}
				/>
			{/if}
			{#if colorPreviewStore.activePicker}
				<button
					bind:this={pickerOverlay}
					type="button"
					class="absolute inset-0 z-30 cursor-crosshair bg-transparent focus-visible:outline-2 focus-visible:outline-white"
					aria-label={m.video_editor_color_picker_instruction()}
					onpointermove={samplePicker}
					onpointerdown={choosePickerColor}
					onkeydown={pickerKeydown}
				>
					{#if pickerColor}
						<span
							class="pointer-events-none absolute overflow-hidden rounded border border-white bg-black shadow-xl"
							style:left={`${pickerX}px`}
							style:top={`${pickerY}px`}
						>
							<canvas bind:this={pickerLoupe} width="72" height="72" class="block size-[72px]"
							></canvas>
							<span class="block px-1 py-0.5 text-center font-mono text-[10px] text-white"
								>{colorHex(pickerColor)}</span
							>
						</span>
					{/if}
				</button>
			{/if}
		{/if}
	</div>
	{#each timelineStore.items.filter((item) => item.type === 'audio' && timelineStore.currentFrame >= item.from && timelineStore.currentFrame < item.from + item.durationInFrames) as item (item.id)}
		<PreviewAudioLayer {item} url={urls[item.mediaId ?? '']} />
	{/each}
</div>
