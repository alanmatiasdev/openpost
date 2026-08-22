<!--
	Timeline panel: ruler, markers, tracks, clips with audio waveform strips,
	playhead, drag move/trim, and zoom. Waveform rendering ported from
	FreeCut (MIT).
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		setCurrentFrame,
		toggleMarkerAtPlayhead,
		removeMarker,
		linkItems,
		unlinkItems
	} from '$lib/video-editor/timeline/actions/items';
	import { getWaveform, cachedWaveform } from '$lib/video-editor/media/waveform-client';
	import type { WaveformData } from '$lib/video-editor/media/waveform-client';
	import { peaksForWindow } from '$lib/video-editor/media/peaks';
	import { filmstripCache, type FilmstripFrame } from '$lib/video-editor/media/filmstrip-client';
	import FilmstripTile from './filmstrip-tile.svelte';
	import { computeFilmstripTiles } from '$lib/video-editor/media/filmstrip-plan';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { Slider } from '$lib/components/ui/slider';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import {
		activeValueAt,
		removeKeyframe,
		setKeyframe,
		setKeyframeEasing
	} from '$lib/video-editor/timeline/actions/keyframes';
	import type {
		EasingConfig,
		EasingType,
		KeyframeProperty,
		TimelineItem,
		TimelineTransition
	} from '$lib/video-editor/project/types';
	import { getAnimatablePropertiesForItem } from '$lib/video-editor/timeline/animated-properties';
	import { BEZIER_PRESETS, buildEasingConfig } from '$lib/video-editor/timeline/easing-presets';
	import {
		planLinkedMoveGesture,
		planLinkedSlipGesture,
		planRateStretchGesture,
		planRippleTrimGesture,
		planRollingTrimGesture,
		planSlideGesture,
		planTrimGesture
	} from '$lib/video-editor/timeline/edit-gesture';
	import {
		buildSnapTargets,
		calculateAdaptiveSnapThreshold,
		calculateMoveSnap,
		type SnapTarget
	} from '$lib/video-editor/timeline/snapping';
	import {
		captureSnapshot,
		restoreSnapshot,
		snapshotsEqual
	} from '$lib/video-editor/timeline/commands/snapshot.svelte';
	import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
	import type { TimelineSnapshot } from '$lib/video-editor/timeline/commands/types';
	import {
		pruneOrphanedTransitions,
		transitionsStore
	} from '$lib/video-editor/timeline/actions/transitions.svelte';
	import {
		buildInsertedGapPreviewUpdatesForSyncLockedTracks,
		buildRemovedIntervalPreviewUpdatesForSyncLockedTracks,
		propagateInsertedGapToSyncLockedTracks,
		propagateRemovedIntervalsToSyncLockedTracks,
		type SyncLockPreviewUpdate
	} from '$lib/video-editor/timeline/actions/sync-lock-ripple';
	import { resolveTransitionWindow } from '$lib/video-editor/timeline/transition-planner';
	import {
		addTrack,
		removeTrack,
		toggleTrackLock,
		toggleTrackMute,
		toggleTrackSolo,
		toggleTrackSyncLock,
		toggleTrackVisibility,
		type TrackKind
	} from '$lib/video-editor/timeline/actions/tracks';
	import TimelineTrackHeader from './timeline-track-header.svelte';
	import {
		canLinkSelection,
		expandSelectionWithLinkedItems,
		getSynchronizedLinkedItems
	} from '$lib/video-editor/timeline/utils/linked-items';
	import { updateTimelineItemSelection } from '$lib/video-editor/timeline/selection';
	import {
		areItemIdListsEqual,
		clearEffectDragData,
		getEffectDragData,
		isDragPointInsideElement,
		resolveEffectDropTargetIds,
		type EffectDragData
	} from '$lib/video-editor/timeline/effect-drop';
	import { addEffectTemplates } from '$lib/video-editor/timeline/actions/effects';
	import { Button } from '$lib/components/ui/button';
	import BetweenHorizontalEndIcon from '@lucide/svelte/icons/between-horizontal-end';
	import DiamondIcon from '@lucide/svelte/icons/diamond';
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import MagnetIcon from '@lucide/svelte/icons/magnet';
	import Link2Icon from '@lucide/svelte/icons/link-2';
	import UnlinkIcon from '@lucide/svelte/icons/unlink';
	import MoveHorizontalIcon from '@lucide/svelte/icons/move-horizontal';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import VideoIcon from '@lucide/svelte/icons/video';
	import AudioLinesIcon from '@lucide/svelte/icons/audio-lines';
	import ZoomInIcon from '@lucide/svelte/icons/zoom-in';
	import ZoomOutIcon from '@lucide/svelte/icons/zoom-out';

	let {
		onedit,
		ontransitionbreak = () => {},
		selectedItemId = $bindable(null),
		selectedItemIds = $bindable([])
	}: {
		onedit: () => void;
		ontransitionbreak?: (count: number) => void;
		selectedItemId?: string | null;
		selectedItemIds?: string[];
	} = $props();
	let scrollContainer = $state<HTMLDivElement | null>(null);
	const waveforms: Record<string, { data: WaveformData | null; failed: boolean }> = {};

	$effect(() => {
		if (!selectedItemId) {
			selectedItemIds = [];
			return;
		}
		if (!selectedItemIds.includes(selectedItemId)) selectedItemIds = [selectedItemId];
	});

	$effect(() => {
		const itemIds = new Set(timelineStore.items.map((item) => item.id));
		const existingIds = selectedItemIds.filter((id) => itemIds.has(id));
		if (existingIds.length !== selectedItemIds.length) selectedItemIds = existingIds;
		if (selectedItemId && !itemIds.has(selectedItemId)) {
			selectedItemId = existingIds.at(-1) ?? null;
		}
	});

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
	type TimelineDragKind =
		| 'move'
		| 'trim-start'
		| 'trim-end'
		| 'slip'
		| 'slide'
		| 'rate-stretch'
		| 'rate-stretch-start'
		| 'rate-stretch-end';
	type AdvancedEditTool = 'slip' | 'slide' | 'rate-stretch';
	let activeEditTool = $state<AdvancedEditTool | null>(null);
	let drag: null | {
		kind: TimelineDragKind;
		id: string;
		pointerId: number;
		startX: number;
		original: TimelineItem;
		beforeSnapshot: TimelineSnapshot;
		editItems: TimelineItem[];
		selectedItemIds: string[];
		snapTargets: SnapTarget[];
		rollingNeighbor: TimelineItem | null;
		ripple: boolean;
		rippleMoveIds: string[];
		breakingTransitionIds: string[];
		stretchHandle: 'start' | 'end';
		slideLeft: TimelineItem | null;
		slideRight: TimelineItem | null;
		activated: boolean;
		latestClientX: number;
		rafId: number | null;
	} = null;
	let activeSnapTarget = $state<SnapTarget | null>(null);
	let syncLockPreviewById = $state<Record<string, SyncLockPreviewUpdate>>({});
	let breakingTransitionPreviewIds = $state<string[]>([]);
	let marquee = $state<{
		startX: number;
		startY: number;
		currentX: number;
		currentY: number;
		active: boolean;
		additive: boolean;
		baseIds: string[];
	} | null>(null);
	let effectDropTargetIds = $state<string[]>([]);
	let effectDropHoveredItemId = $state<string | null>(null);

	$effect(() => {
		if (effectDropTargetIds.length === 0) return;
		const clear = () => clearEffectDropPreview();
		window.addEventListener('dragend', clear);
		window.addEventListener('drop', clear);
		return () => {
			window.removeEventListener('dragend', clear);
			window.removeEventListener('drop', clear);
		};
	});

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

	function filmstripBitmapFor(mediaId: string | undefined, index: number): ImageBitmap | undefined {
		if (!mediaId) return undefined;
		return filmstrips[mediaId]?.frames.find((frame) => frame.index === index)?.bitmap;
	}

	const fps = $derived(editorSession.fps);
	const zoom = $derived(timelineStore.zoomLevel);
	const pxPerFrame = $derived(Math.max(0.25, 4 * zoom));
	const TRACK_HEADER_WIDTH = 180;
	const DRAG_THRESHOLD_PIXELS = 3;
	const timelineWidth = $derived(
		TRACK_HEADER_WIDTH + Math.max(800, (timelineStore.maxItemEndFrame + fps * 10) * pxPerFrame)
	);

	function frameToPx(frame: number): number {
		return frame * pxPerFrame;
	}

	function pxToFrame(px: number): number {
		return Math.max(0, Math.round(px / pxPerFrame));
	}

	function pxDeltaToFrames(px: number): number {
		return Math.round(px / pxPerFrame);
	}

	function timelineX(frame: number): number {
		return TRACK_HEADER_WIDTH + frameToPx(frame);
	}

	function rulerTicks(): number[] {
		// Aim for one label every ~80px.
		const framesPerTickOptions = [1, 5, 10, 30, 60, 150, 300, 600, 1800, 3600];
		const target = Math.ceil(80 / pxPerFrame);
		const step = framesPerTickOptions.find((option) => option >= target) ?? 3600;
		const ticks: number[] = [];
		for (let f = 0; f <= (timelineWidth - TRACK_HEADER_WIDTH) / pxPerFrame; f += step)
			ticks.push(f);
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
		return `left:${timelineX(item.from)}px;width:${frameToPx(item.durationInFrames)}px;background:${fill}`;
	}

	function previewedItem(item: TimelineItem): TimelineItem {
		const preview = syncLockPreviewById[item.id];
		if (!preview) return item;
		return {
			...item,
			from: preview.from ?? item.from,
			durationInFrames: preview.durationInFrames ?? item.durationInFrames
		};
	}

	function setSyncLockPreview(updates: SyncLockPreviewUpdate[]): void {
		syncLockPreviewById = Object.fromEntries(updates.map((update) => [update.id, update]));
	}

	function clearSyncLockPreview(): void {
		syncLockPreviewById = {};
	}

	function transitionGeometry(
		transition: TimelineTransition,
		trackId: string
	): { left: number; width: number } | null {
		const outgoingItem = timelineStore.itemById.get(transition.fromItemId);
		const incomingItem = timelineStore.itemById.get(transition.toItemId);
		if (
			!outgoingItem ||
			!incomingItem ||
			syncLockPreviewById[outgoingItem.id]?.hidden ||
			syncLockPreviewById[incomingItem.id]?.hidden ||
			outgoingItem.trackId !== trackId ||
			incomingItem.trackId !== trackId
		)
			return null;
		const outgoing = previewedItem(outgoingItem);
		const incoming = previewedItem(incomingItem);
		const window = resolveTransitionWindow(transition, outgoing, incoming);
		if (!window) return null;
		return {
			left: timelineX(window.startFrame),
			width: Math.max(2, frameToPx(window.durationInFrames))
		};
	}

	function seekFromEvent(event: MouseEvent): void {
		if (!scrollContainer) return;
		const rect = scrollContainer.getBoundingClientRect();
		setCurrentFrame(
			pxToFrame(event.clientX - rect.left + scrollContainer.scrollLeft - TRACK_HEADER_WIDTH)
		);
	}

	function clearEffectDropPreview(): void {
		effectDropTargetIds = [];
		effectDropHoveredItemId = null;
	}

	function resolveEffectTargets(itemId: string, payload: EffectDragData | null): string[] {
		if (!payload) return [];
		const lockedTrackIds = new Set(
			timelineStore.tracks.filter((track) => track.locked).map((track) => track.id)
		);
		return resolveEffectDropTargetIds({
			hoveredItemId: itemId,
			items: timelineStore.items,
			selectedItemIds
		}).filter((targetId) => {
			const target = timelineStore.itemById.get(targetId);
			return !!target && !lockedTrackIds.has(target.trackId);
		});
	}

	function previewEffectDrop(event: DragEvent, itemId: string): void {
		const targetItemIds = resolveEffectTargets(itemId, getEffectDragData());
		if (targetItemIds.length === 0) {
			clearEffectDropPreview();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		if (
			effectDropHoveredItemId === itemId &&
			areItemIdListsEqual(effectDropTargetIds, targetItemIds)
		) {
			return;
		}
		effectDropTargetIds = targetItemIds;
		effectDropHoveredItemId = itemId;
	}

	function leaveEffectDrop(event: DragEvent, itemId: string): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		if (isDragPointInsideElement(event, event.currentTarget)) return;
		if (effectDropHoveredItemId === itemId) clearEffectDropPreview();
	}

	function dropEffect(event: DragEvent, itemId: string): void {
		const payload = getEffectDragData();
		const targetItemIds = resolveEffectTargets(itemId, payload);
		clearEffectDropPreview();
		clearEffectDragData();
		if (!payload || targetItemIds.length === 0) return;
		event.preventDefault();
		event.stopPropagation();
		if (addEffectTemplates(targetItemIds, payload.effects)) onedit();
	}

	function marqueeStyle(): string {
		if (!marquee || !scrollContainer) return '';
		const rect = scrollContainer.getBoundingClientRect();
		const left =
			Math.min(marquee.startX, marquee.currentX) - rect.left + scrollContainer.scrollLeft;
		const top = Math.min(marquee.startY, marquee.currentY) - rect.top + scrollContainer.scrollTop;
		return `left:${left}px;top:${top}px;width:${Math.abs(marquee.currentX - marquee.startX)}px;height:${Math.abs(marquee.currentY - marquee.startY)}px`;
	}

	function updateMarqueeSelection(): void {
		if (!marquee?.active || !scrollContainer) return;
		const selectionRect = {
			left: Math.min(marquee.startX, marquee.currentX),
			right: Math.max(marquee.startX, marquee.currentX),
			top: Math.min(marquee.startY, marquee.currentY),
			bottom: Math.max(marquee.startY, marquee.currentY)
		};
		const hitIds = Array.from(
			scrollContainer.querySelectorAll<HTMLElement>('[data-timeline-item-id]')
		)
			.filter((element) => {
				const rect = element.getBoundingClientRect();
				return (
					rect.left < selectionRect.right &&
					rect.right > selectionRect.left &&
					rect.top < selectionRect.bottom &&
					rect.bottom > selectionRect.top
				);
			})
			.map((element) => element.dataset.timelineItemId)
			.filter((id): id is string => id !== undefined);
		selectedItemIds = marquee.additive
			? Array.from(new Set([...marquee.baseIds, ...hitIds]))
			: hitIds;
		selectedItemId = hitIds.at(-1) ?? selectedItemIds.at(-1) ?? null;
	}

	function onMarqueePointerMove(event: PointerEvent): void {
		if (!marquee) return;
		marquee.currentX = event.clientX;
		marquee.currentY = event.clientY;
		if (
			!marquee.active &&
			Math.hypot(event.clientX - marquee.startX, event.clientY - marquee.startY) >=
				DRAG_THRESHOLD_PIXELS
		) {
			marquee.active = true;
		}
		updateMarqueeSelection();
	}

	function finishMarquee(): void {
		if (!marquee) return;
		if (!marquee.active && !marquee.additive) {
			selectedItemIds = [];
			selectedItemId = null;
		}
		marquee = null;
		window.removeEventListener('pointermove', onMarqueePointerMove);
		window.removeEventListener('pointerup', finishMarquee);
		window.removeEventListener('pointercancel', finishMarquee);
	}

	function startMarquee(event: PointerEvent): void {
		if (event.button !== 0 || drag || marquee) return;
		const target = event.target;
		if (!(target instanceof HTMLElement) || !target.closest('[data-track]')) return;
		if (target.closest('button, input, select, textarea, [data-marquee-ignore]')) return;
		event.preventDefault();
		const additive = event.metaKey || event.ctrlKey || event.shiftKey;
		marquee = {
			startX: event.clientX,
			startY: event.clientY,
			currentX: event.clientX,
			currentY: event.clientY,
			active: false,
			additive,
			baseIds: additive ? [...selectedItemIds] : []
		};
		window.addEventListener('pointermove', onMarqueePointerMove);
		window.addEventListener('pointerup', finishMarquee);
		window.addEventListener('pointercancel', finishMarquee);
	}

	function trackForItem(item: TimelineItem) {
		return timelineStore.tracks.find((track) => track.id === item.trackId);
	}

	function snapTargetsFor(ids: string[]): SnapTarget[] {
		return buildSnapTargets({
			items: timelineStore.items,
			tracks: timelineStore.tracks,
			transitions: transitionsStore.list,
			markers: timelineStore.markers,
			currentFrame: timelineStore.currentFrame,
			durationInFrames: timelineStore.maxItemEndFrame + fps * 10,
			fps,
			zoomLevel: zoom,
			excludeItemIds: ids
		});
	}

	function findRollingNeighbor(item: TimelineItem, kind: TimelineDragKind): TimelineItem | null {
		if (kind === 'trim-end') {
			const end = item.from + item.durationInFrames;
			return (
				timelineStore.items.find(
					(candidate) =>
						candidate.id !== item.id && candidate.trackId === item.trackId && candidate.from === end
				) ?? null
			);
		}
		if (kind === 'trim-start') {
			return (
				timelineStore.items.find(
					(candidate) =>
						candidate.id !== item.id &&
						candidate.trackId === item.trackId &&
						candidate.from + candidate.durationInFrames === item.from
				) ?? null
			);
		}
		return null;
	}

	interface SlideNeighbors {
		left: TimelineItem | null;
		right: TimelineItem | null;
	}

	function findSlideNeighbors(item: TimelineItem): SlideNeighbors {
		const end = item.from + item.durationInFrames;
		return {
			left:
				timelineStore.items.find(
					(candidate) =>
						candidate.id !== item.id &&
						candidate.trackId === item.trackId &&
						candidate.from + candidate.durationInFrames === item.from
				) ?? null,
			right:
				timelineStore.items.find(
					(candidate) =>
						candidate.id !== item.id && candidate.trackId === item.trackId && candidate.from === end
				) ?? null
		};
	}

	function unlockedEditItems(snapshot: TimelineSnapshot): TimelineItem[] {
		const lockedTrackIds = new Set(
			snapshot.tracks.filter((track) => track.locked).map((track) => track.id)
		);
		return snapshot.items.map((item) =>
			(!timelineStore.linkedSelectionEnabled || lockedTrackIds.has(item.trackId)) &&
			item.linkedGroupId
				? { ...item, linkedGroupId: undefined }
				: item
		);
	}

	function selectItem(event: MouseEvent, id: string): void {
		const selection = updateTimelineItemSelection(
			timelineStore.items,
			selectedItemIds,
			id,
			timelineStore.linkedSelectionEnabled,
			event.metaKey || event.ctrlKey
		);
		selectedItemIds = selection.ids;
		selectedItemId = selection.primaryId;
	}

	function linkSelection(): void {
		if (!linkItems(selectedItemIds)) return;
		selectedItemIds = expandSelectionWithLinkedItems(timelineStore.items, selectedItemIds);
		selectedItemId = selectedItemIds.at(-1) ?? null;
		onedit();
	}

	function unlinkSelection(): void {
		if (!unlinkItems(selectedItemIds)) return;
		onedit();
	}

	function onPanelKeydown(event: KeyboardEvent): void {
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			target.matches('input, textarea, select, [contenteditable="true"]')
		)
			return;
		if (
			(event.key === 'l' || event.key === 'L') &&
			event.altKey &&
			(event.ctrlKey || event.metaKey)
		) {
			event.preventDefault();
			linkSelection();
		} else if ((event.key === 'l' || event.key === 'L') && event.altKey && event.shiftKey) {
			event.preventDefault();
			unlinkSelection();
		} else if (
			(event.key === 'r' || event.key === 'R') &&
			!event.altKey &&
			!event.ctrlKey &&
			!event.metaKey
		) {
			event.preventDefault();
			toggleEditTool('rate-stretch');
		}
	}

	function isRateStretchKind(kind: TimelineDragKind): boolean {
		return kind === 'rate-stretch' || kind === 'rate-stretch-start' || kind === 'rate-stretch-end';
	}

	function rateStretchHandle(kind: TimelineDragKind): 'start' | 'end' {
		return kind === 'rate-stretch-start' ? 'start' : 'end';
	}

	function startDrag(event: PointerEvent, id: string, requestedKind: TimelineDragKind): void {
		if (event.button !== 0) return;
		clearSyncLockPreview();
		breakingTransitionPreviewIds = [];
		event.stopPropagation();
		if (event.metaKey || event.ctrlKey || !selectedItemIds.includes(id)) selectItem(event, id);
		else selectedItemId = id;
		const item = timelineStore.itemById.get(id);
		if (!item || trackForItem(item)?.locked) return;
		const kind = requestedKind === 'move' && event.altKey ? 'slip' : requestedKind;
		if (
			(kind === 'slip' || kind === 'slide' || isRateStretchKind(kind)) &&
			item.type !== 'video' &&
			item.type !== 'audio'
		)
			return;
		const rollingNeighbor =
			(kind === 'trim-start' || kind === 'trim-end') && event.altKey && !event.shiftKey
				? findRollingNeighbor(item, kind)
				: null;
		if ((kind === 'trim-start' || kind === 'trim-end') && event.altKey && !rollingNeighbor) return;
		const ripple = (kind === 'trim-start' || kind === 'trim-end') && event.shiftKey;
		const breakingTransitionIds =
			(kind === 'trim-start' || kind === 'trim-end') && !event.shiftKey && !event.altKey
				? transitionsStore.list
						.filter((transition) =>
							kind === 'trim-start'
								? transition.toItemId === item.id
								: transition.fromItemId === item.id
						)
						.map((transition) => transition.id)
				: [];
		const slideNeighbors = kind === 'slide' ? findSlideNeighbors(item) : null;
		breakingTransitionPreviewIds = breakingTransitionIds;
		const beforeSnapshot = captureSnapshot();
		const editItems = unlockedEditItems(beforeSnapshot);
		const moveSelectionIds = selectedItemIds.includes(id) ? selectedItemIds : [id];
		const synchronizedIds = Array.from(
			new Set(
				moveSelectionIds.flatMap((selectedId) =>
					getSynchronizedLinkedItems(editItems, selectedId).map((candidate) => candidate.id)
				)
			)
		);
		const rippleDownstreamIds = ripple
			? editItems
					.filter(
						(candidate) =>
							candidate.trackId === item.trackId &&
							candidate.from >= item.from + item.durationInFrames
					)
					.map((candidate) => candidate.id)
			: [];
		const excludedIds = [
			...synchronizedIds,
			...rippleDownstreamIds,
			...(rollingNeighbor ? [rollingNeighbor.id] : []),
			...(slideNeighbors?.left ? [slideNeighbors.left.id] : []),
			...(slideNeighbors?.right ? [slideNeighbors.right.id] : [])
		];
		event.preventDefault();
		drag = {
			kind,
			id,
			pointerId: event.pointerId,
			startX: event.clientX,
			original: $state.snapshot(item),
			beforeSnapshot,
			editItems,
			selectedItemIds: [...moveSelectionIds],
			snapTargets: snapTargetsFor(excludedIds),
			rollingNeighbor: rollingNeighbor ? $state.snapshot(rollingNeighbor) : null,
			ripple,
			rippleMoveIds: [],
			breakingTransitionIds,
			stretchHandle: rateStretchHandle(kind),
			slideLeft: slideNeighbors?.left ? $state.snapshot(slideNeighbors.left) : null,
			slideRight: slideNeighbors?.right ? $state.snapshot(slideNeighbors.right) : null,
			activated: kind === 'trim-start' || kind === 'trim-end' || isRateStretchKind(kind),
			latestClientX: event.clientX,
			rafId: null
		};
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
		window.addEventListener('pointercancel', onPointerCancel);
		window.addEventListener('keydown', onDragKeyDown);
		window.addEventListener('keyup', onDragKeyUp);
	}

	function snapThreshold(): number {
		return calculateAdaptiveSnapThreshold(zoom, pxPerFrame);
	}

	function onPointerMove(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		drag.latestClientX = event.clientX;
		if (drag.rafId !== null) return;
		drag.rafId = requestAnimationFrame(() => {
			if (!drag) return;
			drag.rafId = null;
			applyPointerFrame(drag.latestClientX);
		});
	}

	function applyPointerFrame(clientX: number): void {
		if (!drag) return;
		const pixelDelta = clientX - drag.startX;
		if (!drag.activated && Math.abs(pixelDelta) < DRAG_THRESHOLD_PIXELS) return;
		drag.activated = true;
		const deltaFrames = pxDeltaToFrames(pixelDelta);
		if (drag.kind === 'move') {
			const proposed = Math.max(0, drag.original.from + deltaFrames);
			const snap = timelineStore.snapEnabled
				? calculateMoveSnap(
						proposed,
						drag.original.durationInFrames,
						drag.snapTargets,
						snapThreshold()
					)
				: { snappedFrame: proposed, snapTarget: null, didSnap: false };
			const from = Math.max(0, snap.snappedFrame);
			activeSnapTarget = from === snap.snappedFrame ? snap.snapTarget : null;
			timelineStore._moveItems(
				planLinkedMoveGesture(drag.original, from, drag.editItems, drag.selectedItemIds)
			);
			return;
		}
		if (drag.kind === 'slip') {
			activeSnapTarget = null;
			const updates = planLinkedSlipGesture(
				drag.original,
				deltaFrames,
				drag.editItems,
				fps,
				drag.beforeSnapshot.transitions
			);
			if (updates.length > 0) timelineStore._updateItems(updates);
			return;
		}
		if (drag.kind === 'slide') {
			const plan = planSlideGesture(
				drag.original,
				drag.slideLeft,
				drag.slideRight,
				deltaFrames,
				drag.editItems,
				fps,
				timelineStore.snapEnabled ? drag.snapTargets : [],
				snapThreshold(),
				drag.beforeSnapshot.transitions
			);
			activeSnapTarget = plan.snapTarget;
			timelineStore._updateItems([
				{ id: drag.id, patch: plan.itemPatch },
				...(drag.slideLeft && plan.leftPatch
					? [{ id: drag.slideLeft.id, patch: plan.leftPatch }]
					: []),
				...(drag.slideRight && plan.rightPatch
					? [{ id: drag.slideRight.id, patch: plan.rightPatch }]
					: []),
				...(plan.linkedPatches ?? [])
			]);
			return;
		}
		if (isRateStretchKind(drag.kind)) {
			const plan = planRateStretchGesture(
				drag.original,
				drag.stretchHandle,
				deltaFrames,
				drag.editItems,
				fps,
				timelineStore.snapEnabled ? drag.snapTargets : [],
				snapThreshold(),
				drag.beforeSnapshot.transitions
			);
			if (!plan) return;
			activeSnapTarget = plan.snapTarget;
			timelineStore._updateItems([
				{ id: drag.id, patch: plan.patch },
				...(plan.linkedPatches ?? []),
				...plan.moves.map((move) => ({ id: move.id, patch: { from: move.from } }))
			]);
			return;
		}
		if (drag.ripple) {
			const handle = drag.kind === 'trim-start' ? 'start' : 'end';
			const plan = planRippleTrimGesture(
				drag.original,
				handle,
				deltaFrames,
				drag.editItems,
				fps,
				timelineStore.snapEnabled ? drag.snapTargets : [],
				snapThreshold(),
				drag.beforeSnapshot.transitions
			);
			activeSnapTarget = plan.snapTarget;
			timelineStore._updateItems([
				{ id: drag.id, patch: plan.patch },
				...(plan.linkedPatches ?? []),
				...plan.moves.map((move) => ({ id: move.id, patch: { from: move.from } }))
			]);
			drag.rippleMoveIds = plan.moves.map((move) => move.id);
			const durationInFrames = plan.patch.durationInFrames ?? drag.original.durationInFrames;
			const shift = durationInFrames - drag.original.durationInFrames;
			const editedTrackIds = new Set(
				getSynchronizedLinkedItems(drag.editItems, drag.original.id).map(
					(candidate) => candidate.trackId
				)
			);
			const oldEnd = drag.original.from + drag.original.durationInFrames;
			setSyncLockPreview(
				shift < 0
					? buildRemovedIntervalPreviewUpdatesForSyncLockedTracks({
							items: drag.beforeSnapshot.items,
							tracks: drag.beforeSnapshot.tracks,
							editedTrackIds,
							intervals: [{ start: oldEnd + shift, end: oldEnd }]
						})
					: shift > 0
						? buildInsertedGapPreviewUpdatesForSyncLockedTracks({
								items: drag.beforeSnapshot.items,
								tracks: drag.beforeSnapshot.tracks,
								editedTrackIds,
								cutFrame: oldEnd,
								amount: shift
							})
						: []
			);
			return;
		}
		if (drag.rollingNeighbor) {
			const left = drag.kind === 'trim-end' ? drag.original : drag.rollingNeighbor;
			const right = drag.kind === 'trim-start' ? drag.original : drag.rollingNeighbor;
			const plan = planRollingTrimGesture(
				left,
				right,
				deltaFrames,
				drag.editItems,
				fps,
				timelineStore.snapEnabled ? drag.snapTargets : [],
				snapThreshold(),
				drag.beforeSnapshot.transitions
			);
			if (plan) {
				activeSnapTarget = plan.snapTarget;
				timelineStore._updateItems([
					{ id: left.id, patch: plan.leftPatch },
					{ id: right.id, patch: plan.rightPatch },
					...(plan.linkedPatches ?? [])
				]);
			}
			return;
		}
		const handle = drag.kind === 'trim-start' ? 'start' : 'end';
		const breakingTransitionIds = drag.breakingTransitionIds;
		const plan = planTrimGesture(
			drag.original,
			handle,
			deltaFrames,
			drag.editItems,
			fps,
			timelineStore.snapEnabled ? drag.snapTargets : [],
			snapThreshold(),
			drag.beforeSnapshot.transitions.filter(
				(transition) => !breakingTransitionIds.includes(transition.id)
			)
		);
		activeSnapTarget = plan.snapTarget;
		timelineStore._updateItems([{ id: drag.id, patch: plan.patch }, ...(plan.linkedPatches ?? [])]);
	}

	function commandTypeFor(kind: TimelineDragKind, rolling = false, ripple = false): string {
		if (ripple) return 'RIPPLE_EDIT';
		if (rolling) return 'ROLLING_EDIT';
		if (kind === 'trim-start') return 'TRIM_ITEM_START';
		if (kind === 'trim-end') return 'TRIM_ITEM_END';
		if (kind === 'slip') return 'SLIP_ITEM';
		if (kind === 'slide') return 'SLIDE_EDIT';
		if (isRateStretchKind(kind)) return 'RATE_STRETCH_ITEM';
		return 'MOVE_ITEMS';
	}

	function finishDrag(cancelled: boolean): void {
		if (!drag) return;
		const completed = drag;
		if (completed.rafId !== null) cancelAnimationFrame(completed.rafId);
		if (cancelled) {
			restoreSnapshot(completed.beforeSnapshot);
		} else if (completed.ripple) {
			const current = timelineStore.itemById.get(completed.id);
			const shift = current ? current.durationInFrames - completed.original.durationInFrames : 0;
			if (shift !== 0) {
				const editedTrackIds = new Set(
					getSynchronizedLinkedItems(completed.editItems, completed.original.id).map(
						(candidate) => candidate.trackId
					)
				);
				const oldEnd = completed.original.from + completed.original.durationInFrames;
				if (shift < 0) {
					propagateRemovedIntervalsToSyncLockedTracks({
						editedTrackIds,
						intervals: [{ start: oldEnd + shift, end: oldEnd }]
					});
				} else {
					propagateInsertedGapToSyncLockedTracks({
						editedTrackIds,
						cutFrame: oldEnd,
						amount: shift
					});
				}
				pruneOrphanedTransitions();
			}
		}
		const completedItem = timelineStore.itemById.get(completed.id);
		const didTrim =
			completedItem !== undefined &&
			(completedItem.from !== completed.original.from ||
				completedItem.durationInFrames !== completed.original.durationInFrames);
		if (!cancelled && didTrim && completed.breakingTransitionIds.length > 0) {
			const breakingIds = new Set(completed.breakingTransitionIds);
			const previousCount = transitionsStore.list.length;
			transitionsStore.setAll(
				transitionsStore.list.filter((transition) => !breakingIds.has(transition.id))
			);
			const removedCount = previousCount - transitionsStore.list.length;
			if (removedCount > 0) ontransitionbreak(removedCount);
		}
		clearSyncLockPreview();
		breakingTransitionPreviewIds = [];
		if (!cancelled && !snapshotsEqual(completed.beforeSnapshot, captureSnapshot())) {
			commandHistory.addUndoEntry(
				{
					type: commandTypeFor(completed.kind, completed.rollingNeighbor !== null, completed.ripple)
				},
				completed.beforeSnapshot
			);
			onedit();
		}
		drag = null;
		activeSnapTarget = null;
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', onPointerUp);
		window.removeEventListener('pointercancel', onPointerCancel);
		window.removeEventListener('keydown', onDragKeyDown);
		window.removeEventListener('keyup', onDragKeyUp);
	}

	function onPointerUp(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (drag.rafId !== null) {
			cancelAnimationFrame(drag.rafId);
			drag.rafId = null;
		}
		applyPointerFrame(drag.latestClientX);
		finishDrag(false);
	}

	function onPointerCancel(event: PointerEvent): void {
		if (drag && event.pointerId === drag.pointerId) finishDrag(true);
	}

	function setRippleMode(enabled: boolean): void {
		if (
			!drag ||
			(drag.kind !== 'trim-start' && drag.kind !== 'trim-end') ||
			drag.rollingNeighbor ||
			drag.breakingTransitionIds.length > 0 ||
			drag.ripple === enabled
		)
			return;
		if (!enabled && drag.rippleMoveIds.length > 0) {
			const originalById = new Map(drag.editItems.map((item) => [item.id, item]));
			timelineStore._moveItems(
				drag.rippleMoveIds.flatMap((id) => {
					const original = originalById.get(id);
					return original ? [{ id, from: original.from }] : [];
				})
			);
			drag.rippleMoveIds = [];
		}
		drag.ripple = enabled;
		if (!enabled) clearSyncLockPreview();
		applyPointerFrame(drag.latestClientX);
	}

	function onDragKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Shift') {
			setRippleMode(true);
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			finishDrag(true);
		}
	}

	function onDragKeyUp(event: KeyboardEvent): void {
		if (event.key === 'Shift') setRippleMode(false);
	}

	function applyKeyboardEdit(
		event: KeyboardEvent,
		item: TimelineItem,
		kind: TimelineDragKind
	): void {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		if (trackForItem(item)?.locked) return;
		event.preventDefault();
		event.stopPropagation();
		const direction = event.key === 'ArrowLeft' ? -1 : 1;
		const delta = direction * (event.shiftKey ? 10 : 1);
		const before = captureSnapshot();
		const editItems = unlockedEditItems(before);
		if (kind === 'move') {
			timelineStore._moveItems(
				planLinkedMoveGesture(
					item,
					Math.max(0, item.from + delta),
					editItems,
					selectedItemIds.includes(item.id) ? selectedItemIds : [item.id]
				)
			);
		} else if (kind === 'slip') {
			const updates = planLinkedSlipGesture(item, delta, editItems, fps, before.transitions);
			if (updates.length > 0) timelineStore._updateItems(updates);
		} else if (kind === 'slide') {
			const { left, right } = findSlideNeighbors(item);
			const plan = planSlideGesture(
				item,
				left,
				right,
				delta,
				editItems,
				fps,
				[],
				1,
				before.transitions
			);
			timelineStore._updateItems([
				{ id: item.id, patch: plan.itemPatch },
				...(left && plan.leftPatch ? [{ id: left.id, patch: plan.leftPatch }] : []),
				...(right && plan.rightPatch ? [{ id: right.id, patch: plan.rightPatch }] : []),
				...(plan.linkedPatches ?? [])
			]);
		} else if (isRateStretchKind(kind)) {
			const plan = planRateStretchGesture(
				item,
				rateStretchHandle(kind),
				delta,
				editItems,
				fps,
				[],
				1,
				before.transitions
			);
			if (plan) {
				timelineStore._updateItems([
					{ id: item.id, patch: plan.patch },
					...(plan.linkedPatches ?? []),
					...plan.moves.map((move) => ({ id: move.id, patch: { from: move.from } }))
				]);
			}
		} else if (event.altKey) {
			const neighbor = findRollingNeighbor(item, kind);
			if (!neighbor) return;
			const left = kind === 'trim-end' ? item : neighbor;
			const right = kind === 'trim-start' ? item : neighbor;
			const plan = planRollingTrimGesture(
				left,
				right,
				delta,
				editItems,
				fps,
				[],
				1,
				before.transitions
			);
			if (plan) {
				timelineStore._updateItems([
					{ id: left.id, patch: plan.leftPatch },
					{ id: right.id, patch: plan.rightPatch },
					...(plan.linkedPatches ?? [])
				]);
			}
		} else {
			const plan = planTrimGesture(
				item,
				kind === 'trim-start' ? 'start' : 'end',
				delta,
				editItems,
				fps,
				[],
				1,
				before.transitions
			);
			timelineStore._updateItems([
				{ id: item.id, patch: plan.patch },
				...(plan.linkedPatches ?? [])
			]);
		}
		if (!snapshotsEqual(before, captureSnapshot())) {
			commandHistory.addUndoEntry({ type: commandTypeFor(kind, event.altKey) }, before);
			onedit();
		}
	}

	function addNamedTrack(kind: TrackKind): void {
		const number = timelineStore.tracks.filter((track) => track.kind === kind).length + 1;
		addTrack(
			kind,
			kind === 'video'
				? m.video_editor_track_video_name({ number })
				: m.video_editor_track_audio_name({ number })
		);
		onedit();
	}

	function toggleEditTool(tool: AdvancedEditTool): void {
		activeEditTool = activeEditTool === tool ? null : tool;
	}

	function editTrack(action: () => boolean): void {
		if (action()) onedit();
	}

	function deleteTrack(trackId: string): void {
		const selectedWasRemoved =
			timelineStore.itemById.get(selectedItemId ?? '')?.trackId === trackId;
		if (!removeTrack(trackId)) return;
		if (selectedWasRemoved) selectedItemId = null;
		onedit();
	}

	onDestroy(() => {
		if (drag) finishDrag(true);
		if (marquee) finishMarquee();
		clearEffectDropPreview();
		clearEffectDragData();
		for (const unsubscribe of filmstripUnsubscribers.values()) unsubscribe();
	});

	function zoomBy(factor: number): void {
		timelineStore._setZoomLevel(zoom * factor);
	}

	let pendingKeyframeProperty = $state<KeyframeProperty>('opacity');
	let selectedKeyframe = $state<{ property: KeyframeProperty; frame: number } | null>(null);
	const BEZIER_KEYS = ['x1', 'y1', 'x2', 'y2'] satisfies Array<'x1' | 'y1' | 'x2' | 'y2'>;
	const SPRING_KEYS = ['tension', 'friction', 'mass'] satisfies Array<
		'tension' | 'friction' | 'mass'
	>;

	const selectedItem = $derived(
		selectedItemId ? timelineStore.itemById.get(selectedItemId) : undefined
	);
	const canLinkSelectedItems = $derived(canLinkSelection(timelineStore.items, selectedItemIds));
	const canUnlinkSelectedItems = $derived(
		selectedItemIds.some((id) => timelineStore.itemById.get(id)?.linkedGroupId !== undefined)
	);
	const keyframeRows = $derived.by(() => {
		if (!selectedItem) return [];
		return getAnimatablePropertiesForItem(selectedItem).filter(
			(property) => (selectedItem.keyframes?.[property]?.frames.length ?? 0) > 0
		);
	});
	const availableKeyframeProperties = $derived(
		selectedItem ? getAnimatablePropertiesForItem(selectedItem) : []
	);
	const keyframePropertyOptions = $derived(
		availableKeyframeProperties.map((property) => ({
			value: property,
			label: keyframeLabel(property)
		}))
	);
	const easingOptions = $derived([
		{ value: 'linear', label: 'Linear' },
		{ value: 'hold', label: 'Hold' },
		{ value: 'ease-in', label: 'Ease in' },
		{ value: 'ease-out', label: 'Ease out' },
		{ value: 'ease-in-out', label: 'Ease in/out' },
		{ value: 'cubic-bezier', label: 'Cubic bezier' },
		{ value: 'spring', label: 'Spring' }
	]);
	const bezierOptions = $derived([
		{ value: '', label: 'Custom' },
		...BEZIER_PRESETS.map((preset) => ({ value: preset.value, label: preset.label }))
	]);
	const selectedKeyframeTrack = $derived(
		selectedItem && selectedKeyframe
			? selectedItem.keyframes?.[selectedKeyframe.property]
			: undefined
	);
	const selectedKeyframeIndex = $derived(
		selectedKeyframeTrack && selectedKeyframe
			? selectedKeyframeTrack.frames.indexOf(selectedKeyframe.frame)
			: -1
	);
	const selectedEasing = $derived(
		selectedKeyframeIndex >= 0
			? (selectedKeyframeTrack?.easings?.[selectedKeyframeIndex] ?? 'linear')
			: 'linear'
	);
	const selectedEasingConfig = $derived(
		selectedKeyframeIndex >= 0
			? (selectedKeyframeTrack?.easingConfigs?.[selectedKeyframeIndex] ?? undefined)
			: undefined
	);

	function keyframeLabel(property: KeyframeProperty): string {
		return property.replace(/([a-z])([A-Z])/g, '$1 $2');
	}

	function addKeyframeAtPlayhead(property: KeyframeProperty): void {
		const item = selectedItem;
		if (!item) return;
		const frame = Math.max(0, timelineStore.currentFrame - item.from);
		const value =
			activeValueAt(item, property, timelineStore.currentFrame) ??
			(property === 'opacity' || property === 'volume' ? 1 : 0);
		if (setKeyframe(item.id, property, frame, value)) onedit();
	}

	function removeKeyframeAt(property: KeyframeProperty, frame: number): void {
		const item = selectedItem;
		if (!item) return;
		if (removeKeyframe(item.id, property, frame)) onedit();
	}

	function commitEasing(easing: EasingType, config?: EasingConfig): void {
		if (!selectedItem || !selectedKeyframe) return;
		if (
			setKeyframeEasing(
				selectedItem.id,
				selectedKeyframe.property,
				selectedKeyframe.frame,
				easing,
				config ?? buildEasingConfig(easing, selectedEasingConfig)
			)
		)
			onedit();
	}

	function commitBezier(key: 'x1' | 'y1' | 'x2' | 'y2', value: number): void {
		const bezier = {
			x1: 0.42,
			y1: 0,
			x2: 0.58,
			y2: 1,
			...selectedEasingConfig?.bezier,
			[key]: value
		};
		commitEasing('cubic-bezier', { type: 'cubic-bezier', bezier });
	}

	function commitSpring(key: 'tension' | 'friction' | 'mass', value: number): void {
		const spring = {
			tension: 170,
			friction: 26,
			mass: 1,
			...selectedEasingConfig?.spring,
			[key]: value
		};
		commitEasing('spring', { type: 'spring', spring });
	}

	function easingFromValue(value: string): EasingType {
		switch (value) {
			case 'hold':
			case 'ease-in':
			case 'ease-out':
			case 'ease-in-out':
			case 'cubic-bezier':
			case 'spring':
				return value;
			default:
				return 'linear';
		}
	}

	function setPendingKeyframeProperty(value: string): void {
		const property = availableKeyframeProperties.find((candidate) => candidate === value);
		if (property) pendingKeyframeProperty = property;
	}

	function applyBezierPreset(value: string): void {
		const preset = BEZIER_PRESETS.find((candidate) => candidate.value === value);
		if (preset) commitEasing('cubic-bezier', { type: 'cubic-bezier', bezier: preset.points });
	}

	function bezierValue(key: 'x1' | 'y1' | 'x2' | 'y2'): number {
		return selectedEasingConfig?.bezier?.[key] ?? { x1: 0.42, y1: 0, x2: 0.58, y2: 1 }[key];
	}

	function springValue(key: 'tension' | 'friction' | 'mass'): number {
		return selectedEasingConfig?.spring?.[key] ?? { tension: 170, friction: 26, mass: 1 }[key];
	}
</script>

<svelte:window onkeydown={onPanelKeydown} />

<div class="flex items-center gap-2 px-3 py-1">
	<span class="text-xs text-[oklch(0.65_0.015_55)]">{m.video_editor_timeline()}</span>
	<div class="flex items-center gap-0.5 border-l border-[oklch(0.25_0.015_55)] pl-2">
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded"
			aria-label={m.video_editor_track_add_video()}
			title={m.video_editor_track_add_video()}
			onclick={() => addNamedTrack('video')}
		>
			<VideoIcon class="size-3.5" />
			<PlusIcon class="-ml-1 size-2.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded"
			aria-label={m.video_editor_track_add_audio()}
			title={m.video_editor_track_add_audio()}
			onclick={() => addNamedTrack('audio')}
		>
			<AudioLinesIcon class="size-3.5" />
			<PlusIcon class="-ml-1 size-2.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]"
			data-active={timelineStore.snapEnabled}
			aria-pressed={timelineStore.snapEnabled}
			aria-label={timelineStore.snapEnabled
				? m.video_editor_snap_disable()
				: m.video_editor_snap_enable()}
			title={timelineStore.snapEnabled
				? m.video_editor_snap_disable()
				: m.video_editor_snap_enable()}
			onclick={() => timelineStore._setSnapEnabled(!timelineStore.snapEnabled)}
		>
			<MagnetIcon class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]"
			data-active={timelineStore.linkedSelectionEnabled}
			aria-pressed={timelineStore.linkedSelectionEnabled}
			aria-label={timelineStore.linkedSelectionEnabled
				? m.video_editor_linked_selection_disable()
				: m.video_editor_linked_selection_enable()}
			title={m.video_editor_linked_selection_hint()}
			onclick={() =>
				timelineStore._setLinkedSelectionEnabled(!timelineStore.linkedSelectionEnabled)}
		>
			<Link2Icon class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]"
			data-active={activeEditTool === 'slip'}
			aria-pressed={activeEditTool === 'slip'}
			aria-label={m.video_editor_slip()}
			title={m.video_editor_slip()}
			onclick={() => toggleEditTool('slip')}
		>
			<MoveHorizontalIcon class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]"
			data-active={activeEditTool === 'slide'}
			aria-pressed={activeEditTool === 'slide'}
			aria-label={m.video_editor_slide()}
			title={m.video_editor_slide()}
			onclick={() => toggleEditTool('slide')}
		>
			<BetweenHorizontalEndIcon class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]"
			data-active={activeEditTool === 'rate-stretch'}
			aria-pressed={activeEditTool === 'rate-stretch'}
			aria-label={m.video_editor_rate_stretch()}
			title={m.video_editor_rate_stretch()}
			onclick={() => toggleEditTool('rate-stretch')}
		>
			<GaugeIcon class="size-3.5" />
		</Button>
	</div>
	<div class="ml-auto flex items-center gap-1">
		{#if selectedItem}
			<Button
				variant="ghost"
				size="icon"
				class="size-7 rounded"
				disabled={!canLinkSelectedItems}
				aria-label={m.video_editor_link_selected()}
				title={m.video_editor_link_selected_hint()}
				onclick={linkSelection}
			>
				<Link2Icon class="size-3.5" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="size-7 rounded"
				disabled={!canUnlinkSelectedItems}
				aria-label={m.video_editor_unlink_selected()}
				title={m.video_editor_unlink_selected_hint()}
				onclick={unlinkSelection}
			>
				<UnlinkIcon class="size-3.5" />
			</Button>
			<span class="mr-2 max-w-40 truncate rounded bg-[oklch(0.22_0.01_50)] px-2 py-0.5 text-xs">
				{selectedItemIds.length > 1
					? m.video_editor_items_selected({ count: selectedItemIds.length })
					: selectedItem.label}
			</span>
			<AppSelect
				class="h-7 w-36 text-xs"
				value={pendingKeyframeProperty}
				options={keyframePropertyOptions}
				ariaLabel="Animated property"
				onValueChange={setPendingKeyframeProperty}
			/>
			<button
				type="button"
				class="flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-[oklch(0.22_0.01_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
				onclick={() => addKeyframeAtPlayhead(pendingKeyframeProperty)}
				><DiamondIcon class="size-2.5 fill-current" /> Add key</button
			>
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
	onpointerdown={startMarquee}
	class="relative max-h-72 min-h-32 overflow-x-auto overflow-y-hidden pb-2"
	role="region"
	aria-label={m.video_editor_timeline()}
>
	<div class="relative select-none" style="width:{timelineWidth}px">
		{#if marquee?.active}
			<div
				class="pointer-events-none absolute z-50 border border-[oklch(0.72_0.14_45)] bg-[oklch(0.66_0.14_45_/_0.16)]"
				style={marqueeStyle()}
				data-timeline-marquee
			></div>
		{/if}
		<!-- Ruler -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -- ruler seeks on click; arrow-key transport is global (Space/step buttons) -->
		<div
			class="sticky top-0 z-20 h-6 cursor-pointer border-b border-[oklch(0.25_0.015_55)] bg-[oklch(0.16_0.008_55)]"
			onclick={seekFromEvent}
		>
			<div
				class="sticky left-0 z-30 h-full border-r border-[oklch(0.25_0.015_55)] bg-[oklch(0.16_0.008_55)]"
				style="width:{TRACK_HEADER_WIDTH}px"
			></div>
			{#each rulerTicks() as tick (tick)}
				<span
					class="absolute bottom-0 border-l border-[oklch(0.3_0.01_55)] pl-1 font-mono text-[9px] text-[oklch(0.65_0.015_55)]"
					style="left:{timelineX(tick)}px"
				>
					{tickLabel(tick)}
				</span>
			{/each}
		</div>

		<!-- Tracks -->
		{#each [...timelineStore.tracks].sort((a, b) => a.order - b.order) as track (track.id)}
			<div
				class="relative border-b border-[oklch(0.22_0.01_50)] {track.visible === false ||
				(track.kind === 'audio' && track.muted)
					? 'bg-[oklch(0.13_0.006_55)]'
					: ''}"
				style="height:{track.height}px"
				data-track={track.id}
			>
				<div
					class="sticky left-0 z-30 h-full"
					style="width:{TRACK_HEADER_WIDTH}px"
					data-marquee-ignore
				>
					<TimelineTrackHeader
						{track}
						itemCount={(timelineStore.itemsByTrackId.get(track.id) ?? []).length}
						canDelete={timelineStore.tracks.length > 1}
						onvisibility={() => editTrack(() => toggleTrackVisibility(track.id))}
						onmute={() => editTrack(() => toggleTrackMute(track.id))}
						onsolo={() => editTrack(() => toggleTrackSolo(track.id))}
						onlock={() => editTrack(() => toggleTrackLock(track.id))}
						onsynclock={() => editTrack(() => toggleTrackSyncLock(track.id))}
						ondelete={() => deleteTrack(track.id)}
					/>
				</div>
				{#each timelineStore.itemsByTrackId.get(track.id) ?? [] as item (item.id)}
					{@const displayItem = previewedItem(item)}
					{#if !syncLockPreviewById[item.id]?.hidden}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="group absolute top-1 h-[calc(100%-8px)] touch-none overflow-hidden rounded-sm border text-left {selectedItemIds.includes(
								item.id
							)
								? 'border-[oklch(0.66_0.14_45)] ring-1 ring-[oklch(0.66_0.14_45)]'
								: 'border-transparent'} {track.locked ? 'opacity-75' : ''}"
							style={clipStyle(displayItem)}
							data-timeline-item-id={item.id}
							ondragenter={(event) => previewEffectDrop(event, item.id)}
							ondragover={(event) => previewEffectDrop(event, item.id)}
							ondragleave={(event) => leaveEffectDrop(event, item.id)}
							ondrop={(event) => dropEffect(event, item.id)}
						>
							{#if effectDropTargetIds.includes(item.id)}
								<div
									class="pointer-events-none absolute inset-0 z-40 rounded-sm border border-dashed border-[oklch(0.66_0.14_45_/_0.95)] bg-[oklch(0.66_0.14_45_/_0.16)] shadow-[inset_0_0_0_1px_oklch(0.66_0.14_45_/_0.35)]"
									data-effect-drop-preview
								>
									{#if effectDropHoveredItemId === item.id}
										<span class="sr-only" role="status" aria-live="polite">
											{m.video_editor_effects_drop_ready({ count: effectDropTargetIds.length })}
										</span>
									{/if}
									{#if effectDropHoveredItemId === item.id && effectDropTargetIds.length > 1}
										<span
											class="absolute top-1 right-1 rounded-full bg-[oklch(0.66_0.14_45)] px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-[oklch(0.16_0.008_55)]"
										>
											{m.video_editor_effects_drop_count({ count: effectDropTargetIds.length })}
										</span>
									{/if}
								</div>
							{/if}
							<button
								type="button"
								class="absolute inset-0 flex min-w-0 cursor-grab items-center overflow-hidden text-left active:cursor-grabbing disabled:cursor-default"
								aria-label={`${item.label}. ${m.video_editor_timing_keyboard()}`}
								onclick={(event) => {
									event.stopPropagation();
									if (event.detail === 0) selectItem(event, item.id);
								}}
								onkeydown={(event) => applyKeyboardEdit(event, item, activeEditTool ?? 'move')}
								onpointerdown={(event) => startDrag(event, item.id, activeEditTool ?? 'move')}
							>
								{#if item.type === 'video' && filmstripTilesFor(displayItem)}
									<div class="pointer-events-none absolute inset-x-0 bottom-0 h-8 overflow-hidden">
										{#each filmstripTilesFor(displayItem) as tile (tile.index)}
											<FilmstripTile
												bitmap={filmstripBitmapFor(item.mediaId, tile.index)}
												url={tile.url}
												style="left:{tile.x}px;width:{tile.width}px"
											/>
										{/each}
									</div>
								{/if}
								{#if waveformSvgPoints(displayItem)}
									<svg
										class="pointer-events-none absolute inset-x-0 bottom-0 h-10 w-full"
										viewBox="0 0 {Math.max(8, frameToPx(displayItem.durationInFrames) - 4)} 80"
										preserveAspectRatio="none"
									>
										<polyline
											points={waveformSvgPoints(displayItem)}
											fill="none"
											stroke="oklch(0.85 0.03 120)"
											stroke-width="0.6"
										/>
									</svg>
								{/if}
								<span class="relative z-10 truncate px-2 text-[11px] text-white/90"
									>{item.label}</span
								>
							</button>
							<button
								type="button"
								class="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize bg-white/15 opacity-0 group-hover:opacity-100 hover:bg-white/40 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white"
								aria-label={m.video_editor_trim_start()}
								title={m.video_editor_trim_keyboard()}
								onkeydown={(event) =>
									applyKeyboardEdit(
										event,
										item,
										activeEditTool === 'rate-stretch' ? 'rate-stretch-start' : 'trim-start'
									)}
								onpointerdown={(event) =>
									startDrag(
										event,
										item.id,
										activeEditTool === 'rate-stretch' ? 'rate-stretch-start' : 'trim-start'
									)}
							></button>
							<button
								type="button"
								class="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize bg-white/15 opacity-0 group-hover:opacity-100 hover:bg-white/40 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white"
								aria-label={m.video_editor_trim_end()}
								title={m.video_editor_trim_keyboard()}
								onkeydown={(event) =>
									applyKeyboardEdit(
										event,
										item,
										activeEditTool === 'rate-stretch' ? 'rate-stretch-end' : 'trim-end'
									)}
								onpointerdown={(event) =>
									startDrag(
										event,
										item.id,
										activeEditTool === 'rate-stretch' ? 'rate-stretch-end' : 'trim-end'
									)}
							></button>
						</div>
					{/if}
				{/each}
				{#each transitionsStore.list as transition (transition.id)}
					{@const geometry = transitionGeometry(transition, track.id)}
					{#if geometry && !breakingTransitionPreviewIds.includes(transition.id)}
						<div
							class="pointer-events-none absolute top-1 z-10 flex h-[calc(100%-8px)] items-start justify-center overflow-hidden rounded-sm border border-[oklch(0.76_0.14_45_/_0.7)] bg-[repeating-linear-gradient(135deg,oklch(0.66_0.14_45_/_0.2)_0_4px,transparent_4px_8px)]"
							style="left:{geometry.left}px;width:{geometry.width}px"
							data-transition-id={transition.id}
						>
							<span
								class="mt-0.5 rounded bg-[oklch(0.16_0.008_55_/_0.88)] px-1 text-[8px] font-medium whitespace-nowrap text-[oklch(0.88_0.09_65)]"
							>
								{transition.type === 'fade-black'
									? m.video_editor_transition_dip_black()
									: m.video_editor_transition_cross_dissolve()}
							</span>
						</div>
					{/if}
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
								style="left:{timelineX(selectedItem.from + frame)}px"
								title="{keyframeLabel(property)} — {m.video_editor_marker_remove_hint()}"
								onclick={() => setCurrentFrame(selectedItem.from + frame)}
								onfocus={() => (selectedKeyframe = { property, frame })}
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
				{#if selectedKeyframe && selectedKeyframeIndex >= 0}
					<div
						class="flex min-h-10 flex-wrap items-center gap-2 border-t border-[oklch(0.25_0.015_55)] px-2 py-1 text-[10px]"
					>
						<span class="font-medium capitalize">{keyframeLabel(selectedKeyframe.property)}</span>
						<label class="flex items-center gap-1">
							Easing
							<AppSelect
								class="h-7 w-28 text-[10px]"
								value={selectedEasing}
								options={easingOptions}
								onValueChange={(value) => commitEasing(easingFromValue(value))}
							/>
						</label>
						{#if selectedEasing === 'cubic-bezier'}
							<AppSelect
								class="h-7 w-32 text-[10px]"
								value=""
								options={bezierOptions}
								ariaLabel="Bezier preset"
								onValueChange={applyBezierPreset}
							/>
							{#each BEZIER_KEYS as key (key)}<label
									>{key}<Input
										class="ml-0.5 w-14 rounded bg-[oklch(0.22_0.01_50)] px-1 py-0.5"
										type="number"
										step="0.01"
										min={key === 'x1' || key === 'x2' ? 0 : -2}
										max={key === 'x1' || key === 'x2' ? 1 : 3}
										value={bezierValue(key)}
										onchange={(event) => commitBezier(key, event.currentTarget.valueAsNumber)}
									/></label
								>{/each}
						{:else if selectedEasing === 'spring'}
							{#each SPRING_KEYS as key (key)}<label
									>{key}<Input
										class="ml-0.5 w-14 rounded bg-[oklch(0.22_0.01_50)] px-1 py-0.5"
										type="number"
										step="0.1"
										value={springValue(key)}
										onchange={(event) => commitSpring(key, event.currentTarget.valueAsNumber)}
									/></label
								>{/each}
						{/if}
					</div>
				{/if}
			</div>
		{/if}

		{#if activeSnapTarget}
			<div
				class="pointer-events-none absolute top-0 bottom-0 z-40 w-px bg-[oklch(0.76_0.14_45)]"
				style="left:{timelineX(activeSnapTarget.frame)}px"
				data-snap-guideline={activeSnapTarget.type}
			>
				<span
					class="absolute top-6 left-1 rounded border border-[oklch(0.48_0.11_45)] bg-[oklch(0.18_0.015_55)] px-1.5 py-0.5 font-mono text-[9px] whitespace-nowrap text-[oklch(0.88_0.09_65)]"
				>
					{m.video_editor_snapped_to({ time: tickLabel(activeSnapTarget.frame) })}
				</span>
			</div>
		{/if}

		<!-- Playhead -->
		<div
			class="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-[oklch(0.66_0.14_45)]"
			style="left:{timelineX(timelineStore.currentFrame)}px"
		></div>
		<!-- In/out range shade -->
		{#if timelineStore.inPoint !== null && timelineStore.outPoint !== null}
			<div
				class="pointer-events-none absolute top-6 bottom-0 z-10 bg-[oklch(0.66_0.14_45_/_0.08)]"
				style="left:{timelineX(timelineStore.inPoint)}px;width:{frameToPx(
					(timelineStore.outPoint ?? 0) - (timelineStore.inPoint ?? 0)
				)}px"
			></div>
		{/if}
	</div>
</div>
