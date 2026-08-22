<!-- Multi-track composited preview with direct transform gizmos. -->
<script lang="ts">
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
	const activeItems = $derived.by(() =>
		paintOrder(timelineStore.items, timelineStore.tracks).filter(
			(item) =>
				['video', 'image', 'text', 'subtitle'].includes(item.type) &&
				timelineStore.currentFrame >= item.from &&
				timelineStore.currentFrame < item.from + item.durationInFrames
		)
	);
	const selectedItem = $derived(
		selectedItemId ? activeItems.find((item) => item.id === selectedItemId) : undefined
	);
	const selectedResolved = $derived(
		selectedItem ? resolveAnimatedItemAt(selectedItem, timelineStore.currentFrame) : undefined
	);

	$effect(() => {
		for (const media of mediaPool.mediaList) {
			if (media.tags.includes('audio') || urls[media.id]) continue;
			void getMediaObjectUrl(media)
				.then((url) => {
					urls = { ...urls, [media.id]: url };
				})
				.catch(() => undefined);
		}
		return () => {
			for (const id of Object.keys(urls)) revokeMediaObjectUrl(id);
			urls = {};
		};
	});

	function transitionOpacity(item: TimelineItem): number {
		for (const transition of transitionsStore.list) {
			const state = transitionAtFrame(transition, timelineStore.currentFrame, editorSession.fps);
			if (!state) continue;
			if (state.outgoing === item.id) return outgoingOpacity(state.type, state.progress);
			if (state.incoming === item.id) return incomingOpacity(state.type, state.progress);
		}
		return 1;
	}

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

<div class="flex min-h-0 flex-1 items-center justify-center bg-[oklch(0.12_0.008_55)] p-4">
	<div
		bind:this={viewport}
		class="[container-type:size] relative max-h-full max-w-full overflow-hidden rounded-md bg-black"
		style="aspect-ratio: {aspect}; width: min(100%, calc((100vh - 19rem) * {canvasWidth /
			canvasHeight}));"
	>
		{#if activeItems.length === 0}
			<div
				class="flex size-full min-h-48 min-w-80 items-center justify-center border border-dashed border-[oklch(0.3_0.01_55)] text-xs text-[oklch(0.65_0.015_55)]"
			>
				{m.video_editor_preview_empty()}
			</div>
		{:else}
			{#each activeItems as item (item.id)}
				<PreviewLayer
					{item}
					url={urls[item.mediaId ?? '']}
					{canvasWidth}
					{canvasHeight}
					selected={item.id === selectedItemId}
					opacityMultiplier={transitionOpacity(item)}
					overrideTransform={item.id === selectedItemId ? (draftTransform ?? undefined) : undefined}
					onselect={() => (selectedItemId = item.id)}
				/>
			{/each}
			{#if selectedResolved}
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
						aria-label="Resize selected clip"
						onpointerdown={(event) => startGizmo(event, 'resize')}
					></button>
				</div>
			{/if}
		{/if}
	</div>
</div>
