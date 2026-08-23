/**
 * Timeline item edit actions. Every public action runs inside `execute`
 * so it lands as one undoable step.
 *
 * Ported from FreeCut (MIT) — item-actions.ts / split-actions.ts, trimmed
 * to v1 (no transitions, no keyframes, no sync-lock ripple).
 */

import type { ShapeType, TimelineItem } from '$lib/video-editor/project/types';
import { timelineStore } from '../stores/timeline-store.svelte';
import { editorSession } from '../../editor.svelte';
import { execute } from '../commands/command-store.svelte';
import {
	canLinkSelection,
	expandSelectionWithLinkedItems,
	getLinkedItemIds,
	getSynchronizedLinkedCounterpartPair
} from '../utils/linked-items';
import { pruneOrphanedTransitions } from './transitions.svelte';
import { transitionsStore } from './transitions-store.svelte';
import { snapshotTimelineState } from '../utils/state-snapshot.svelte';
import { canJoinMultipleItems, joinedTimelineItem } from '../join-items';

export function addItems(newItems: TimelineItem[]): void {
	execute('ADD_ITEMS', () => {
		timelineStore._setItems([...timelineStore.items, ...newItems]);
	});
}

export function addTextItem(label: string): string {
	return execute('ADD_TEXT_ITEM', () => {
		const topVisualTrack = timelineStore.tracks
			.filter((track) => track.kind !== 'audio')
			.toSorted((left, right) => left.order - right.order)[0];
		if (!topVisualTrack) throw new Error('A visual track is required to add text.');

		const id = crypto.randomUUID();
		timelineStore._addItem({
			id,
			trackId: topVisualTrack.id,
			from: timelineStore.currentFrame,
			durationInFrames: timelineStore.fps * 3,
			label,
			text: label,
			type: 'text'
		});
		return id;
	});
}

const SHAPE_LABELS = {
	rectangle: 'Rectangle',
	circle: 'Circle',
	triangle: 'Triangle',
	ellipse: 'Ellipse',
	star: 'Star',
	polygon: 'Polygon',
	heart: 'Heart',
	path: 'Path'
} satisfies Record<ShapeType, string>;

/** Add a styled three-second shape on the top unlocked visual track. */
export function addShapeItem(shapeType: ShapeType, label = SHAPE_LABELS[shapeType]): string {
	return execute('ADD_SHAPE_ITEM', () => {
		const topVisualTrack = timelineStore.tracks
			.filter((track) => track.kind !== 'audio' && !track.locked)
			.toSorted((left, right) => left.order - right.order)[0];
		if (!topVisualTrack) throw new Error('An unlocked visual track is required to add a shape.');

		const projectWidth = editorSession.project?.metadata.width ?? 1920;
		const projectHeight = editorSession.project?.metadata.height ?? 1080;
		const size = Math.max(80, Math.round(Math.min(projectWidth, projectHeight) * 0.28));
		const id = crypto.randomUUID();
		timelineStore._addItem({
			id,
			trackId: topVisualTrack.id,
			from: timelineStore.currentFrame,
			durationInFrames: timelineStore.fps * 3,
			label,
			type: 'shape',
			shapeType,
			fillColor: '#f97316',
			fillEnabled: shapeType !== 'path',
			strokeColor: '#ffffff',
			strokeEnabled: shapeType === 'path',
			strokeWidth: 8,
			shapePoints: shapeType === 'star' ? 5 : shapeType === 'polygon' ? 6 : undefined,
			shapeInnerRadius: shapeType === 'star' ? 0.5 : undefined,
			transform: {
				width:
					shapeType === 'path'
						? projectWidth
						: shapeType === 'rectangle' || shapeType === 'ellipse'
							? Math.round(size * 1.35)
							: size,
				height: shapeType === 'path' ? projectHeight : size,
				aspectRatioLocked:
					shapeType !== 'path' && shapeType !== 'rectangle' && shapeType !== 'ellipse'
			}
		});
		return id;
	});
}

/** Add a three-second adjustment layer on the top visual track at the playhead. */
export function addAdjustmentLayer(label: string): string {
	return execute('ADD_ADJUSTMENT_LAYER', () => {
		let topVisualTrack = timelineStore.tracks
			.filter((track) => track.kind !== 'audio' && !track.locked)
			.toSorted((left, right) => left.order - right.order)[0];
		if (!topVisualTrack) throw new Error('An unlocked visual track is required.');

		const from = timelineStore.currentFrame;
		const durationInFrames = timelineStore.fps * 3;
		const end = from + durationInFrames;
		const topTrackOccupied = (timelineStore.itemsByTrackId.get(topVisualTrack.id) ?? []).some(
			(item) => item.from < end && item.from + item.durationInFrames > from
		);
		if (topTrackOccupied) {
			topVisualTrack = {
				...topVisualTrack,
				id: crypto.randomUUID(),
				name: label,
				order: Math.min(...timelineStore.tracks.map((track) => track.order)) - 1
			};
			timelineStore._setTracks([...timelineStore.tracks, topVisualTrack]);
		}

		const id = crypto.randomUUID();
		timelineStore._addItem({
			id,
			trackId: topVisualTrack.id,
			from,
			durationInFrames,
			label,
			type: 'adjustment',
			effects: []
		});
		return id;
	});
}

export function removeItems(ids: string[]): void {
	execute('REMOVE_ITEMS', () => {
		const expanded = expandSelectionWithLinkedItems(timelineStore.items, ids);
		timelineStore._removeItems(expanded);
		pruneOrphanedTransitions();
	});
}

export function moveItems(updates: Array<{ id: string; from: number; trackId?: string }>): void {
	if (updates.length === 0) return;
	execute('MOVE_ITEMS', () => {
		timelineStore._moveItems(updates);
	});
}

export function updateItemProperties(
	id: string,
	patch: Partial<TimelineItem>,
	commandType = 'UPDATE_ITEM'
): void {
	execute(commandType, () => {
		timelineStore._updateItems([{ id, patch }]);
	});
}

/** Toggle reverse playback for media clips and their linked A/V companions. */
export function setItemsReversed(ids: string[], isReversed: boolean): string[] {
	const expanded = expandSelectionWithLinkedItems(timelineStore.items, ids);
	const trackById = new Map(timelineStore.tracks.map((track) => [track.id, track]));
	const targets = expanded.filter((id) => {
		const item = timelineStore.itemById.get(id);
		return (
			item !== undefined &&
			(item.type === 'video' || item.type === 'audio') &&
			trackById.get(item.trackId)?.locked !== true &&
			item.isReversed !== isReversed
		);
	});
	if (targets.length === 0) return [];
	execute('SET_ITEMS_REVERSED', () => {
		timelineStore._updateItems(targets.map((id) => ({ id, patch: { isReversed } })));
	});
	return targets;
}

/** Join continuous split siblings, including synchronized linked A/V counterparts. */
export function joinItems(ids: string[]): string[] {
	const selected = ids
		.map((id) => timelineStore.itemById.get(id))
		.filter((item): item is TimelineItem => item !== undefined);
	if (selected.length < 2) return [];
	const candidates = new Map(selected.map((item) => [item.id, item]));
	if (selected.length === 2 && timelineStore.linkedSelectionEnabled) {
		const pair = getSynchronizedLinkedCounterpartPair(
			timelineStore.items,
			selected[0]!.id,
			selected[1]!.id
		);
		if (pair) {
			candidates.set(pair.leftCounterpart.id, pair.leftCounterpart);
			candidates.set(pair.rightCounterpart.id, pair.rightCounterpart);
		}
	}

	const groups = new Map<string, TimelineItem[]>();
	for (const item of candidates.values()) {
		const key = `${item.trackId}\u0000${item.type}`;
		const group = groups.get(key) ?? [];
		group.push(item);
		groups.set(key, group);
	}
	const lockedTrackIds = new Set(
		timelineStore.tracks.filter((track) => track.locked).map((track) => track.id)
	);
	const joinableGroups = [...groups.values()].filter(
		(group) => !lockedTrackIds.has(group[0]!.trackId) && canJoinMultipleItems(group)
	);
	if (joinableGroups.length === 0) return [];

	return execute('JOIN_ITEMS', () => {
		const joinedByPrimaryId = new Map<string, TimelineItem>();
		const replacementByRemovedId = new Map<string, string>();
		for (const group of joinableGroups) {
			const sorted = group.toSorted((left, right) => left.from - right.from);
			const joined = joinedTimelineItem(sorted);
			if (!joined) continue;
			joinedByPrimaryId.set(joined.id, joined);
			for (const removed of sorted.slice(1)) replacementByRemovedId.set(removed.id, joined.id);
		}
		if (joinedByPrimaryId.size === 0) return [];

		timelineStore._setItems(
			timelineStore.items
				.filter((item) => !replacementByRemovedId.has(item.id))
				.map((item) => joinedByPrimaryId.get(item.id) ?? item)
		);
		transitionsStore.setAll(
			transitionsStore.list.flatMap((transition) => {
				const fromItemId =
					replacementByRemovedId.get(transition.fromItemId) ?? transition.fromItemId;
				const toItemId = replacementByRemovedId.get(transition.toItemId) ?? transition.toItemId;
				return fromItemId === toItemId ? [] : [{ ...transition, fromItemId, toItemId }];
			})
		);
		pruneOrphanedTransitions();
		return [...joinedByPrimaryId.keys()];
	});
}

export function duplicateItems(ids: string[]): string[] {
	return execute('DUPLICATE_ITEMS', () => {
		const byId = timelineStore.itemById;
		const duplicates: TimelineItem[] = [];
		for (const id of ids) {
			const item = byId.get(id);
			if (!item) continue;
			duplicates.push({
				...snapshotTimelineState(item),
				id: crypto.randomUUID(),
				originId: item.originId ?? item.id,
				from: item.from + item.durationInFrames
			});
		}
		if (duplicates.length > 0) {
			timelineStore._setItems([...timelineStore.items, ...duplicates]);
		}
		return duplicates.map((item) => item.id);
	});
}

export function linkItems(ids: string[]): boolean {
	const items = timelineStore.items;
	if (!canLinkSelection(items, ids)) return false;
	const expandedIds = expandSelectionWithLinkedItems(items, ids);
	const selectedIds = expandedIds.filter((id) => timelineStore.itemById.has(id));
	if (selectedIds.length < 2) return false;

	execute('LINK_ITEMS', () => {
		const linkedGroupId = crypto.randomUUID();
		timelineStore._updateItems(selectedIds.map((id) => ({ id, patch: { linkedGroupId } })));
	});
	return true;
}

export function unlinkItems(ids: string[]): boolean {
	const unlinkIds = new Set<string>();
	for (const id of ids) {
		for (const linkedId of getLinkedItemIds(timelineStore.items, id)) unlinkIds.add(linkedId);
	}
	const linkedIds = [...unlinkIds].filter(
		(id) => timelineStore.itemById.get(id)?.linkedGroupId !== undefined
	);
	if (linkedIds.length === 0) return false;

	execute('UNLINK_ITEMS', () => {
		timelineStore._updateItems(
			linkedIds.map((id) => ({ id, patch: { linkedGroupId: undefined } }))
		);
	});
	return true;
}

/**
 * Split every item crossing `frame` on the given track (or all tracks when
 * undefined). One undo step; keeps selection semantics simple by returning
 * the ids created on the right side.
 */
export function splitAtFrame(frame: number, trackId?: string): { left: string[]; right: string[] } {
	return execute('SPLIT_ITEMS', () => {
		const left: string[] = [];
		const right: string[] = [];
		const targets = timelineStore.items.filter(
			(item) =>
				(!trackId || item.trackId === trackId) &&
				frame > item.from &&
				frame < item.from + item.durationInFrames
		);
		for (const item of targets) {
			const result = timelineStore._splitItem(item.id, frame);
			if (result) {
				left.push(result.leftItem.id);
				right.push(result.rightItem.id);
			}
		}
		return { left, right };
	});
}

/**
 * Split one item at every scene-change frame, right-to-left, as one
 * undoable step. Right-to-left keeps later cut points valid because each
 * split leaves the original id on the shrinking left piece; frames that no
 * longer fall strictly inside it are skipped.
 */
export function splitAtScenes(id: string, frames: number[]): number {
	return execute('SPLIT_AT_SCENES', () => {
		let count = 0;
		for (const frame of [...frames].sort((a, b) => b - a)) {
			if (timelineStore._splitItem(id, frame)) count++;
		}
		return count;
	});
}

export function trimItemStart(id: string, newFrom: number, newSourceStart?: number): boolean {
	return execute('TRIM_ITEM_START', () => {
		const item = timelineStore.itemById.get(id);
		if (!item) return false;
		const delta = newFrom - item.from;
		const nextDuration = item.durationInFrames - delta;
		if (nextDuration <= 0 || delta < 0) return false;
		const patch: Partial<TimelineItem> = {
			from: newFrom,
			durationInFrames: nextDuration
		};
		if ((item.type === 'video' || item.type === 'audio') && newSourceStart !== undefined) {
			patch.sourceStart = newSourceStart;
		}
		timelineStore._updateItems([{ id, patch }]);
		return true;
	});
}

export function trimItemEnd(id: string, newEnd: number, newSourceEnd?: number): boolean {
	return execute('TRIM_ITEM_END', () => {
		const item = timelineStore.itemById.get(id);
		if (!item) return false;
		const nextDuration = newEnd - item.from;
		if (nextDuration <= 0 || newEnd < item.from + 1) return false;
		const patch: Partial<TimelineItem> = { durationInFrames: nextDuration };
		if ((item.type === 'video' || item.type === 'audio') && newSourceEnd !== undefined) {
			patch.sourceEnd = newSourceEnd;
		}
		timelineStore._updateItems([{ id, patch }]);
		return true;
	});
}

/** Ripple delete: remove items and pull later items on the same track left. */
export function rippleDeleteItems(ids: string[], expandLinked = true): void {
	execute('RIPPLE_DELETE', () => {
		const items = timelineStore.items;
		const expanded = new Set(expandLinked ? expandSelectionWithLinkedItems(items, ids) : ids);
		const removedIntervals = items
			.filter((item) => expanded.has(item.id))
			.map((item) => ({
				trackId: item.trackId,
				start: item.from,
				end: item.from + item.durationInFrames
			}));

		const updates: Array<{ id: string; from: number }> = [];
		for (const item of items) {
			if (expanded.has(item.id)) continue;
			const shift = removedIntervals
				.filter((r) => r.trackId === item.trackId && r.end <= item.from)
				.reduce((sum, r) => sum + (r.end - r.start), 0);
			if (shift > 0) updates.push({ id: item.id, from: item.from - shift });
		}
		timelineStore._removeItems([...expanded]);
		timelineStore._moveItems(updates);
		pruneOrphanedTransitions();
	});
}

/** Close one gap between neighbors on a track by sliding the right side left. */
export function closeGapAtPosition(trackId: string, position: number): void {
	execute('CLOSE_GAP', () => {
		const trackItems = (timelineStore.itemsByTrackId.get(trackId) ?? [])
			.slice()
			.sort((a, b) => a.from - b.from);
		const leftEnd = Math.max(
			...trackItems
				.filter((i) => i.from + i.durationInFrames <= position)
				.map((i) => i.from + i.durationInFrames),
			0
		);
		const updates: Array<{ id: string; from: number }> = [];
		for (const item of trackItems) {
			if (item.from >= position) {
				updates.push({
					id: item.id,
					from: Math.max(item.from - (position - leftEnd), leftEnd)
				});
			}
		}
		timelineStore._moveItems(updates);
	});
}

export function setInPoint(frame: number | null): void {
	execute('SET_IN_POINT', () => timelineStore._setInPoint(frame));
}

export function setOutPoint(frame: number | null): void {
	execute('SET_OUT_POINT', () => timelineStore._setOutPoint(frame));
}

export function addMarker(frame: number): string {
	// SAFETY: execute returns the action's own string id unchanged.
	return execute('ADD_MARKER', () => {
		const id = crypto.randomUUID();
		timelineStore._addMarker({ id, frame, color: '#d97746' });
		return id;
	}) as string;
}

export function removeMarker(id: string): void {
	execute('REMOVE_MARKER', () => timelineStore._removeMarker(id));
}

export function updateMarker(
	id: string,
	patch: Partial<{ frame: number; label: string; color: string }>
): boolean {
	if (!timelineStore.markers.some((marker) => marker.id === id)) return false;
	execute('UPDATE_MARKER', () => timelineStore._updateMarker(id, patch));
	return true;
}

export function clearAllMarkers(): boolean {
	if (timelineStore.markers.length === 0) return false;
	execute('CLEAR_MARKERS', () => timelineStore._setMarkers([]));
	timelineStore._setSelectedMarkerId(null);
	return true;
}

export function toggleMarkerAtPlayhead(): void {
	const frame = timelineStore.currentFrame;
	const existing = timelineStore.markers.find((marker) => Math.abs(marker.frame - frame) <= 1);
	if (existing) removeMarker(existing.id);
	else addMarker(frame);
}

/**
 * Slip: shift an item's source window without moving it on the timeline.
 * Delta is clamped so the window stays inside the source material.
 */
export function slipItem(id: string, deltaSourceFrames: number): void {
	execute('SLIP_ITEM', () => {
		const item = timelineStore.itemById.get(id);
		if (!item || (item.type !== 'video' && item.type !== 'audio')) return;
		const start = item.sourceStart ?? 0;
		const end = item.sourceEnd ?? start + item.durationInFrames;
		const limit = (item.sourceDuration ?? end) - (end - start);
		const next = Math.min(Math.max(start + deltaSourceFrames, 0), Math.max(limit, 0));
		timelineStore._updateItems([
			{ id, patch: { sourceStart: next, sourceEnd: next + (end - start) } }
		]);
	});
}

/** Rate-stretch: change playback speed while keeping the item's start fixed. */
export function setItemSpeed(id: string, speed: number): void {
	execute('SET_ITEM_SPEED', () => {
		const item = timelineStore.itemById.get(id);
		if (!item || (item.type !== 'video' && item.type !== 'audio')) return;
		const clamped = Math.min(Math.max(speed, 0.1), 8);
		const previous = item.speed ?? 1;
		if (clamped === previous) return;
		const duration = Math.max(1, Math.round((item.durationInFrames * previous) / clamped));
		timelineStore._updateItems([{ id, patch: { speed: clamped, durationInFrames: duration } }]);
	});
}

export function setCurrentFrame(frame: number): void {
	// Playhead moves are not undoable — they're navigation, not edits.
	editorSession.clock.seek(frame);
}
