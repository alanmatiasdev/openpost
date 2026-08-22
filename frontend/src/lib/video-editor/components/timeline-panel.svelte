<!--
	Timeline panel: ruler, markers, tracks, clips with audio waveform strips,
	playhead, drag move/trim, and zoom. Waveform rendering ported from
	FreeCut (MIT).
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		setCurrentFrame,
		toggleMarkerAtPlayhead,
		removeMarker
	} from '$lib/video-editor/timeline/actions/items';
	import { moveItems } from '$lib/video-editor/timeline/actions/items';
	import { getWaveform, cachedWaveform } from '$lib/video-editor/media/waveform-client';
	import type { WaveformData } from '$lib/video-editor/media/waveform-client';
	import { peaksForWindow } from '$lib/video-editor/media/peaks';
	import { filmstripCache } from '$lib/video-editor/media/filmstrip-client';
	import {
		computeFilmstripTiles,
		type FilmstripFrameRef as FilmstripFrame
	} from '$lib/video-editor/media/filmstrip-plan';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { Slider } from '$lib/components/ui/slider';
	import {
		activeValueAt,
		removeKeyframe,
		setKeyframe
	} from '$lib/video-editor/timeline/actions/keyframes';
	import type { KeyframeProperty, TimelineItem } from '$lib/video-editor/project/types';
	import ZoomInIcon from '@lucide/svelte/icons/zoom-in';
	import ZoomOutIcon from '@lucide/svelte/icons/zoom-out';

	let {
		onedit,
		selectedItemId = $bindable(null)
	}: { onedit: () => void; selectedItemId?: string | null } = $props();
	let scrollContainer = $state<HTMLDivElement | null>(null);
	const waveforms: Record<string, { data: WaveformData | null; failed: boolean }> = {};

	$effect(() => {
		for (const item of timelineStore.items) {
			const mediaId = item.mediaId;
			if (item.type !== 'video' || !mediaId || waveforms[mediaId]) continue;
			const media = mediaPool.get(mediaId);
			if (!media?.audioCodec) continue;
			waveforms[mediaId] = { data: null, failed: false };
			getWaveform(media)
				.then((data) => {
					waveforms[mediaId] = { data, failed: false };
				})
				.catch(() => {
					waveforms[mediaId] = { data: null, failed: true };
				});
		}
	});

	function waveformSvgPoints(item: {
		mediaId?: string;
		sourceStart?: number;
		durationInFrames: number;
	}): string | null {
		if (!item.mediaId) return null;
		const entry = waveforms[item.mediaId];
		const data = entry?.data ?? cachedWaveform(item.mediaId);
		if (!data) return null;
		const width = Math.max(8, frameToPx(item.durationInFrames) - 4);
		const columns = peaksForWindow(
			data,
			item.sourceStart ?? 0,
			(item.sourceStart ?? 0) + item.durationInFrames,
			timelineStore.fps,
			width
		);
		const points: string[] = [];
		for (let column = 0; column < width; column++) {
			const min = columns[column * 2];
			const max = columns[column * 2 + 1];
			points.push(`${column + 2},${(max * 40).toFixed(1)} ${column + 2},${(min * 40).toFixed(1)}`);
		}
		return points.join(' ');
	}
	let drag: null | {
		kind: 'move' | 'trim-end';
		id: string;
		startFrame: number;
		startX: number;
		origFrom: number;
		origDuration: number;
	} = null;

	// Reactive filmstrip state per video mediaId; frames stream in from the
	// extraction worker and tiles render as they arrive.
	const filmstrips = $state<Record<string, { frames: FilmstripFrame[]; failed: boolean }>>({});
	const filmstripUnsubscribers = new Map<string, () => void>();

	$effect(() => {
		for (const item of timelineStore.items) {
			if (item.type !== 'video' || !item.mediaId || filmstrips[item.mediaId]) continue;
			const mediaId = item.mediaId;
			const media = mediaPool.get(mediaId);
			if (!media?.tags.includes('video')) continue;
			filmstrips[mediaId] = { frames: [], failed: false };
			filmstripUnsubscribers.set(
				mediaId,
				filmstripCache.subscribe(mediaId, (filmstrip) => {
					filmstrips[mediaId] = {
						frames: filmstrip.frames.map((frame) => ({ ...frame })),
						failed: false
					};
				})
			);
			filmstripCache.getFilmstrip(media).catch(() => {
				filmstrips[mediaId] = { frames: filmstrips[mediaId]?.frames ?? [], failed: true };
			});
		}
	});

	function filmstripTilesFor(item: {
		mediaId?: string;
		sourceStart?: number;
		sourceFps?: number;
		speed?: number;
		durationInFrames: number;
	}): ReturnType<typeof computeFilmstripTiles> | null {
		if (!item.mediaId) return null;
		const entry = filmstrips[item.mediaId];
		if (!entry || entry.failed || entry.frames.length === 0) return null;
		const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : Math.max(1, fps);
		const speed = item.speed ?? 1;
		const startSeconds = (item.sourceStart ?? 0) / sourceFps;
		const spanSeconds = (item.durationInFrames / fps) * speed;
		if (!(spanSeconds > 0)) return null;
		return computeFilmstripTiles(
			entry.frames,
			startSeconds,
			spanSeconds,
			frameToPx(item.durationInFrames)
		);
	}

	const fps = $derived(editorSession.fps);
	const zoom = $derived(timelineStore.zoomLevel);
	const pxPerFrame = $derived(Math.max(0.25, 4 * zoom));
	const timelineWidth = $derived(
		Math.max(800, (timelineStore.maxItemEndFrame + fps * 10) * pxPerFrame)
	);

	function frameToPx(frame: number): number {
		return frame * pxPerFrame;
	}

	function pxToFrame(px: number): number {
		return Math.max(0, Math.round(px / pxPerFrame));
	}

	function rulerTicks(): number[] {
		// Aim for one label every ~80px.
		const framesPerTickOptions = [1, 5, 10, 30, 60, 150, 300, 600, 1800, 3600];
		const target = Math.ceil(80 / pxPerFrame);
		const step = framesPerTickOptions.find((option) => option >= target) ?? 3600;
		const ticks: number[] = [];
		for (let f = 0; f <= timelineWidth / pxPerFrame; f += step) ticks.push(f);
		return ticks;
	}

	function tickLabel(frame: number): string {
		const total = frame / fps;
		return `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, '0')}`;
	}

	interface ClipPalette {
		video: string;
		audio: string;
		image: string;
		text: string;
		subtitle: string;
	}

	function clipStyle(item: { from: number; durationInFrames: number; type: string }): string {
		const palette: ClipPalette = {
			video: 'oklch(0.4 0.04 250)',
			audio: 'oklch(0.35 0.03 300)',
			image: 'oklch(0.45 0.05 250)',
			text: 'oklch(0.55 0.02 290)',
			subtitle: 'oklch(0.55 0.02 290)'
		};
		// SAFETY: item.type values are exactly the ClipPalette keys.
		const fill = palette[item.type as keyof ClipPalette] ?? palette.video;
		return `left:${frameToPx(item.from)}px;width:${frameToPx(item.durationInFrames)}px;background:${fill}`;
	}

	function seekFromEvent(event: MouseEvent): void {
		if (!scrollContainer) return;
		const rect = scrollContainer.getBoundingClientRect();
		setCurrentFrame(pxToFrame(event.clientX - rect.left + scrollContainer.scrollLeft));
	}

	function startMove(event: MouseEvent, id: string): void {
		event.stopPropagation();
		selectedItemId = id;
		const item = timelineStore.itemById.get(id);
		if (!item) return;
		drag = {
			kind: 'move',
			id,
			startFrame: item.from,
			startX: event.clientX,
			origFrom: item.from,
			origDuration: item.durationInFrames
		};
		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
	}

	function startTrimEnd(event: MouseEvent, id: string): void {
		event.stopPropagation();
		const item = timelineStore.itemById.get(id);
		if (!item) return;
		selectedItemId = id;
		drag = {
			kind: 'trim-end',
			id,
			startFrame: item.from,
			startX: event.clientX,
			origFrom: item.from,
			origDuration: item.durationInFrames
		};
		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
	}

	function onMouseMove(event: MouseEvent): void {
		if (!drag) return;
		const deltaFrames = pxToFrame(event.clientX - drag.startX);
		if (drag.kind === 'move') {
			timelineStore._moveItems([{ id: drag.id, from: Math.max(0, drag.origFrom + deltaFrames) }]);
		} else {
			const nextDuration = Math.max(1, drag.origDuration + deltaFrames);
			timelineStore._updateItems([{ id: drag.id, patch: { durationInFrames: nextDuration } }]);
		}
	}

	function onMouseUp(): void {
		if (!drag) return;
		const item = timelineStore.itemById.get(drag.id);
		if (item && (item.from !== drag.origFrom || item.durationInFrames !== drag.origDuration)) {
			if (drag.kind === 'move') {
				moveItems([{ id: drag.id, from: item.from }]);
			} else if (drag.kind === 'trim-end' && item.sourceFps && item.mediaId === undefined) {
				onedit();
			} else {
				// Trim committed directly; media source windows stay aligned at 1x.
				onedit();
			}
		}
		drag = null;
		window.removeEventListener('mousemove', onMouseMove);
		window.removeEventListener('mouseup', onMouseUp);
	}

	function zoomBy(factor: number): void {
		timelineStore._setZoomLevel(zoom * factor);
	}

	const KEYFRAME_PROPERTIES = ['opacity', 'volume'] as const satisfies readonly KeyframeProperty[];
	type DopesheetProperty = (typeof KEYFRAME_PROPERTIES)[number];
	const DEFAULT_KEYFRAME_VALUES = { opacity: 1, volume: 1 } satisfies Record<
		DopesheetProperty,
		number
	>;

	const selectedItem = $derived(
		selectedItemId ? timelineStore.itemById.get(selectedItemId) : undefined
	);
	const keyframeRows = $derived.by(() => {
		if (!selectedItem) return [];
		return KEYFRAME_PROPERTIES.filter(
			(property) => (selectedItem.keyframes?.[property]?.frames.length ?? 0) > 0
		);
	});

	function keyframeLabel(property: DopesheetProperty): string {
		return property === 'opacity'
			? m.video_editor_keyframe_opacity()
			: m.video_editor_keyframe_volume();
	}

	function addKeyframeAtPlayhead(property: DopesheetProperty): void {
		const item = selectedItem;
		if (!item) return;
		const frame = Math.max(0, timelineStore.currentFrame - item.from);
		const value =
			activeValueAt(item, property, timelineStore.currentFrame) ??
			DEFAULT_KEYFRAME_VALUES[property];
		if (setKeyframe(item.id, property, frame, value)) onedit();
	}

	function removeKeyframeAt(property: DopesheetProperty, frame: number): void {
		const item = selectedItem;
		if (!item) return;
		if (removeKeyframe(item.id, property, frame)) onedit();
	}
</script>

<div class="flex items-center gap-2 px-3 py-1">
	<span class="text-xs text-[oklch(0.65_0.015_55)]">{m.video_editor_timeline()}</span>
	<div class="ml-auto flex items-center gap-1">
		{#if selectedItem}
			<span class="mr-2 max-w-40 truncate rounded bg-[oklch(0.22_0.01_50)] px-2 py-0.5 text-xs">
				{selectedItem.label}
			</span>
			<button
				type="button"
				class="rounded px-1 py-0.5 text-xs hover:bg-[oklch(0.22_0.01_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
				title={m.video_editor_keyframe_add_opacity()}
				onclick={() => addKeyframeAtPlayhead('opacity')}
			>
				◆ {keyframeLabel('opacity')}
			</button>
			<button
				type="button"
				class="rounded px-1 py-0.5 text-xs hover:bg-[oklch(0.22_0.01_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
				title={m.video_editor_keyframe_add_volume()}
				onclick={() => addKeyframeAtPlayhead('volume')}
			>
				◆ {keyframeLabel('volume')}
			</button>
		{/if}
		<button
			type="button"
			class="rounded p-1 hover:bg-[oklch(0.22_0.01_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
			aria-label={m.video_editor_zoom_out()}
			onclick={() => zoomBy(1 / 1.3)}
		>
			<ZoomOutIcon class="size-4" />
		</button>
		<Slider
			class="w-28"
			min={0.01}
			max={50}
			step={0.01}
			value={zoom}
			ariaLabel={m.video_editor_zoom()}
			onValueChange={(value) => timelineStore._setZoomLevel(value)}
		/>
		<button
			type="button"
			class="rounded p-1 hover:bg-[oklch(0.22_0.01_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
			aria-label={m.video_editor_zoom_in()}
			onclick={() => zoomBy(1.3)}
		>
			<ZoomInIcon class="size-4" />
		</button>
	</div>
</div>

<div
	bind:this={scrollContainer}
	class="relative max-h-72 min-h-32 overflow-x-auto overflow-y-hidden pb-2"
	role="region"
	aria-label={m.video_editor_timeline()}
>
	<div class="relative select-none" style="width:{timelineWidth}px">
		<!-- Ruler -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -- ruler seeks on click; arrow-key transport is global (Space/step buttons) -->
		<div
			class="sticky top-0 z-20 h-6 cursor-pointer border-b border-[oklch(0.25_0.015_55)] bg-[oklch(0.16_0.008_55)]"
			onclick={seekFromEvent}
		>
			{#each rulerTicks() as tick (tick)}
				<span
					class="absolute bottom-0 border-l border-[oklch(0.3_0.01_55)] pl-1 font-mono text-[9px] text-[oklch(0.65_0.015_55)]"
					style="left:{frameToPx(tick)}px"
				>
					{tickLabel(tick)}
				</span>
			{/each}
		</div>

		<!-- Tracks -->
		{#each [...timelineStore.tracks].sort((a, b) => b.order - a.order) as track (track.id)}
			<div
				class="relative border-b border-[oklch(0.22_0.01_50)]"
				style="height:{track.height}px"
				data-track={track.id}
			>
				<span
					class="pointer-events-none absolute top-0.5 left-1 z-10 text-[9px] text-[oklch(0.65_0.015_55)] uppercase"
				>
					{track.name}
				</span>
				{#each timelineStore.itemsByTrackId.get(track.id) ?? [] as item (item.id)}
					<div
						role="button"
						tabindex="0"
						class="absolute top-1 flex h-[calc(100%-8px)] cursor-grab items-center overflow-hidden rounded-sm border text-left active:cursor-grabbing {selectedItemId ===
						item.id
							? 'border-[oklch(0.66_0.14_45)] ring-1 ring-[oklch(0.66_0.14_45)]'
							: 'border-transparent'}"
						style={clipStyle(item)}
						onclick={(event) => {
							event.stopPropagation();
							selectedItemId = item.id;
						}}
						onkeydown={(event) => {
							if (event.key === 'Enter') selectedItemId = item.id;
						}}
						onmousedown={(event) => startMove(event, item.id)}
					>
						{#if item.type === 'video' && filmstripTilesFor(item)}
							<div class="pointer-events-none absolute inset-x-0 bottom-0 h-8 overflow-hidden">
								{#each filmstripTilesFor(item) as tile (tile.index)}
									<img
										src={tile.url ?? ''}
										alt=""
										class="absolute top-0 h-full rounded-sm object-cover opacity-90"
										style="left:{tile.x}px;width:{tile.width}px"
									/>
								{/each}
							</div>
						{/if}
						{#if waveformSvgPoints(item)}
							<svg
								class="pointer-events-none absolute inset-x-0 bottom-0 h-10 w-full"
								viewBox="0 0 {Math.max(8, frameToPx(item.durationInFrames) - 4)} 80"
								preserveAspectRatio="none"
							>
								<polyline
									points={waveformSvgPoints(item)}
									fill="none"
									stroke="oklch(0.85 0.03 120)"
									stroke-width="0.6"
								/>
							</svg>
						{/if}
						<span class="truncate px-1.5 text-[11px] text-white/90">{item.label}</span>
						<span
							role="presentation"
							class="absolute top-0 right-0 h-full w-1.5 cursor-ew-resize bg-white/20 hover:bg-white/40"
							onmousedown={(event) => startTrimEnd(event, item.id)}
						></span>
					</div>
				{/each}
			</div>
		{/each}

		<!-- Keyframe dopesheet for the selected clip -->
		{#if selectedItem && keyframeRows.length > 0}
			<div class="relative border-t border-[oklch(0.25_0.015_55)] bg-[oklch(0.145_0.008_55)]">
				<span
					class="pointer-events-none absolute -top-4 left-1 text-[9px] text-[oklch(0.65_0.015_55)] uppercase"
				>
					{m.video_editor_keyframes()}
				</span>
				{#each keyframeRows as property (property)}
					<div class="relative h-5 border-b border-[oklch(0.22_0.01_50)] last:border-b-0">
						<span
							class="pointer-events-none absolute top-1/2 left-1 z-10 -translate-y-1/2 text-[9px] text-[oklch(0.65_0.015_55)] uppercase"
						>
							{keyframeLabel(property)}
						</span>
						{#each selectedItem.keyframes?.[property]?.frames ?? [] as frame (frame)}
							<button
								type="button"
								class="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-[oklch(0.66_0.14_45)] hover:bg-[oklch(0.78_0.14_45)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
								style="left:{frameToPx(selectedItem.from + frame)}px"
								title="{keyframeLabel(property)} — {m.video_editor_marker_remove_hint()}"
								onclick={() => setCurrentFrame(selectedItem.from + frame)}
								ondblclick={() => removeKeyframeAt(property, frame)}
								onkeydown={(event) => {
									if (event.key === 'Enter') setCurrentFrame(selectedItem.from + frame);
									if (event.key === 'Delete' || event.key === 'Backspace') {
										removeKeyframeAt(property, frame);
									}
								}}
							></button>
						{/each}
					</div>
				{/each}
			</div>
		{/if}

		<!-- Playhead -->
		<div
			class="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-[oklch(0.66_0.14_45)]"
			style="left:{frameToPx(timelineStore.currentFrame)}px"
		></div>
		<!-- In/out range shade -->
		{#if timelineStore.inPoint !== null && timelineStore.outPoint !== null}
			<div
				class="pointer-events-none absolute top-6 bottom-0 z-10 bg-[oklch(0.66_0.14_45_/_0.08)]"
				style="left:{frameToPx(timelineStore.inPoint)}px;width:{frameToPx(
					(timelineStore.outPoint ?? 0) - (timelineStore.inPoint ?? 0)
				)}px"
			></div>
		{/if}
	</div>
</div>
