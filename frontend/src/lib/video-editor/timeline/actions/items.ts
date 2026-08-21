/**
 * Timeline item edit actions. Every public action runs inside `execute`
 * so it lands as one undoable step.
 *
 * Ported from FreeCut (MIT) — item-actions.ts / split-actions.ts, trimmed
 * to v1 (no transitions, no keyframes, no sync-lock ripple).
 */

import type { TimelineItem } from '$lib/video-editor/project/types';
import { timelineStore } from '../stores/timeline-store.svelte';
import { execute } from '../commands/command-store.svelte';
import { expandSelectionWithLinkedItems } from '../utils/linked-items';
import { pruneOrphanedTransitions } from './transitions.svelte';

export function addItems(newItems: TimelineItem[]): void {
	execute('ADD_ITEMS', () => {
		timelineStore._setItems([...timelineStore.items, ...newItems]);
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

export function duplicateItems(ids: string[]): string[] {
	return execute('DUPLICATE_ITEMS', () => {
		const byId = timelineStore.itemById;
		const duplicates: TimelineItem[] = [];
		for (const id of ids) {
			const item = byId.get(id);
			if (!item) continue;
			duplicates.push({
				...structuredClone(item),
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

export function linkItems(ids: string[]): void {
	execute('LINK_ITEMS', () => {
		const linkedGroupId = crypto.randomUUID();
		timelineStore._updateItems(ids.map((id) => ({ id, patch: { linkedGroupId } })));
	});
}

export function unlinkItems(ids: string[]): void {
	execute('UNLINK_ITEMS', () => {
		timelineStore._updateItems(ids.map((id) => ({ id, patch: { linkedGroupId: undefined } })));
	});
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

export function trimItemStart(id: string, newFrom: number, newSourceStart?: number): boolean {
	return execute('TRIM_ITEM_START', () => {
		const item = timelineStore.itemById.get(id);
		if (!item) return false;
		const delta = newFrom - item.from;
		const nextDuration = item.durationInFrames - delta;
		if (nextDuration <= 0 || delta < 0) return false;
		const patch: Partial<TimelineItem> = { from: newFrom, durationInFrames: nextDuration };
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
export function rippleDeleteItems(ids: string[]): void {
	execute('RIPPLE_DELETE', () => {
		const items = timelineStore.items;
		const expanded = new Set(expandSelectionWithLinkedItems(items, ids));
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
				updates.push({ id: item.id, from: Math.max(item.from - (position - leftEnd), leftEnd) });
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
		timelineStore._addMarker({ id, frame, color: 'oklch(0.66 0.14 45)' });
		return id;
	}) as string;
}

export function removeMarker(id: string): void {
	execute('REMOVE_MARKER', () => timelineStore._removeMarker(id));
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
		if (!item || item.type === 'text' || item.type === 'subtitle') return;
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
		if (!item || item.type === 'text' || item.type === 'subtitle') return;
		const clamped = Math.min(Math.max(speed, 0.1), 8);
		const previous = item.speed ?? 1;
		if (clamped === previous) return;
		const duration = Math.max(1, Math.round((item.durationInFrames * previous) / clamped));
		timelineStore._updateItems([{ id, patch: { speed: clamped, durationInFrames: duration } }]);
	});
}

export function setCurrentFrame(frame: number): void {
	// Playhead moves are not undoable — they're navigation, not edits.
	timelineStore._setCurrentFrame(frame);
}
