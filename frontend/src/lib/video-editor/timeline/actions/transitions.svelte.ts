/**
 * Transition actions: crossfade and fade-to-black between adjacent clips.
 *
 * A transition lives between two items that touch edge-to-edge on the same
 * track. Splits refuse to land inside a transition zone (FreeCut semantics).
 *
 * Ported from FreeCut (MIT) transition model, trimmed to two v1 types.
 */

import type { TimelineTransition } from '../../project/types';
import { timelineStore } from '../stores/timeline-store.svelte';
import { execute } from '../commands/command-store.svelte';
import { transitionsStore } from './transitions-store.svelte';

export { transitionsStore } from './transitions-store.svelte';

function findEdgePair(fromItemId: string, toItemId: string): boolean {
	const from = timelineStore.itemById.get(fromItemId);
	const to = timelineStore.itemById.get(toItemId);
	if (!from || !to) return false;
	if (from.trackId !== to.trackId) return false;
	return Math.abs(from.from + from.durationInFrames - to.from) <= 1;
}

export function addTransition(
	fromItemId: string,
	toItemId: string,
	type: TimelineTransition['type'] = 'crossfade',
	durationInFrames?: number
): string {
	// SAFETY: execute returns the action's own string result unchanged.
	return execute('ADD_TRANSITION', () => {
		if (!findEdgePair(fromItemId, toItemId)) {
			throw new Error('Transitions need two touching clips on the same track');
		}
		const existing = transitionsStore.forItem(fromItemId) ?? transitionsStore.forItem(toItemId);
		if (existing) throw new Error('Clips already have a transition here');
		const frames = durationInFrames ?? Math.max(2, Math.round(timelineStore.fps / 2));
		const id = crypto.randomUUID();
		transitionsStore.list.push({ id, type, durationInFrames: frames, fromItemId, toItemId });
		return id;
	}) as string;
}

export function removeTransition(id: string): void {
	execute('REMOVE_TRANSITION', () => {
		transitionsStore.setAll(transitionsStore.list.filter((t) => t.id !== id));
	});
}

/** Drop transitions referencing removed items; called after removal edits. */
export function pruneOrphanedTransitions(): void {
	const byId = timelineStore.itemById;
	const next = transitionsStore.list.filter((t) => byId.has(t.fromItemId) && byId.has(t.toItemId));
	if (next.length !== transitionsStore.list.length) transitionsStore.setAll(next);
}

/** Opacity of the incoming clip at progress 0..1 for the transition type. */
export function incomingOpacity(type: TimelineTransition['type'], progress: number): number {
	const p = Math.min(1, Math.max(0, progress));
	if (type === 'fade-black') return p < 0.5 ? 0 : (p - 0.5) * 2;
	return p;
}

/** Opacity of the outgoing clip at progress 0..1 for the transition type. */
export function outgoingOpacity(type: TimelineTransition['type'], progress: number): number {
	const p = Math.min(1, Math.max(0, progress));
	if (type === 'fade-black') return p < 0.5 ? 1 - p * 2 : 0;
	return 1 - p;
}

/**
 * Transition state at an absolute timeline frame for a pair of clips.
 * Returns null outside the window; otherwise the pair + blend progress.
 */
export function transitionAtFrame(
	transition: TimelineTransition,
	frame: number,
	fpsForDuration: number
): {
	outgoing: string;
	incoming: string;
	progress: number;
	type: TimelineTransition['type'];
} | null {
	const from = timelineStore.itemById.get(transition.fromItemId);
	const to = timelineStore.itemById.get(transition.toItemId);
	if (!from || !to) return null;
	const start = from.from + from.durationInFrames - transition.durationInFrames;
	const end = start + transition.durationInFrames;
	if (frame < start || frame >= end) return null;
	const progress = Math.min(1, (frame - start) / Math.max(1, transition.durationInFrames));
	void fpsForDuration;
	return { outgoing: from.id, incoming: to.id, progress, type: transition.type };
}
