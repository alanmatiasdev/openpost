import type {
	MotionModifier,
	MotionModifierType,
	TimelineItem
} from '$lib/video-editor/project/types';
import type { TimelineSnapshot } from '../commands/types';
import { captureSnapshot } from '../commands/snapshot.svelte';
import { commandHistory, execute } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';

export interface MotionModifierAssignment {
	itemId: string;
	modifier: MotionModifier;
}

function withModifier(
	existing: MotionModifier[] | undefined,
	modifier: MotionModifier
): MotionModifier[] {
	return [...(existing ?? []).filter((entry) => entry.type !== modifier.type), modifier];
}

export function applyMotionModifierToItems(assignments: MotionModifierAssignment[]): number {
	if (assignments.length === 0) return 0;
	return execute('APPLY_MOTION_MODIFIERS', () => {
		const updates = assignments.flatMap(({ itemId, modifier }) => {
			const item = timelineStore.itemById.get(itemId);
			return item
				? [{ id: itemId, patch: { motionModifiers: withModifier(item.motionModifiers, modifier) } }]
				: [];
		});
		if (updates.length > 0) timelineStore._updateItems(updates);
		return updates.length;
	});
}

export function removeMotionModifierFromItems(itemIds: string[], type: MotionModifierType): number {
	if (itemIds.length === 0) return 0;
	return execute('REMOVE_MOTION_MODIFIERS', () => {
		const updates: Array<{ id: string; patch: Partial<TimelineItem> }> = [];
		for (const itemId of new Set(itemIds)) {
			const item = timelineStore.itemById.get(itemId);
			if (!item?.motionModifiers?.some((entry) => entry.type === type)) continue;
			const remaining = item.motionModifiers.filter((entry) => entry.type !== type);
			updates.push({
				id: itemId,
				patch: { motionModifiers: remaining.length > 0 ? remaining : undefined }
			});
		}
		if (updates.length > 0) timelineStore._updateItems(updates);
		return updates.length;
	});
}

export function updateMotionModifiersLive(assignments: MotionModifierAssignment[]): void {
	const updates = assignments.flatMap(({ itemId, modifier }) => {
		const item = timelineStore.itemById.get(itemId);
		return item
			? [{ id: itemId, patch: { motionModifiers: withModifier(item.motionModifiers, modifier) } }]
			: [];
	});
	if (updates.length > 0) timelineStore._updateItems(updates);
}

export function beginMotionModifierEdit(): TimelineSnapshot {
	return captureSnapshot();
}

export function commitMotionModifierEdit(
	before: TimelineSnapshot,
	type: MotionModifierType,
	itemIds: string[]
): void {
	commandHistory.addUndoEntry(
		{ type: 'UPDATE_MOTION_MODIFIERS', payload: { type, ids: itemIds } },
		before
	);
}
