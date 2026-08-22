/** Pure edit plans for live timeline pointer and keyboard gestures. */

import type { TimelineItem } from '../project/types';
import {
	calculateTrimSourceUpdate,
	clampToAdjacentItems,
	clampTrimAmount,
	type TrimHandle
} from './utils/trim-utils';
import { getSourceProperties, timelineToSourceFrames } from './utils/source-calculations';
import { calculateEdgeSnap, type SnapTarget } from './snapping';

export interface TrimGesturePlan {
	patch: Partial<TimelineItem>;
	snapTarget: SnapTarget | null;
}

export interface RollingTrimGesturePlan {
	leftPatch: Partial<TimelineItem>;
	rightPatch: Partial<TimelineItem>;
	snapTarget: SnapTarget | null;
}

function tighterDelta(current: number, candidate: number): number {
	if (current > 0) return Math.max(0, Math.min(current, candidate));
	if (current < 0) return Math.min(0, Math.max(current, candidate));
	return 0;
}

function trimPatchForAmount(
	item: TimelineItem,
	handle: TrimHandle,
	amount: number,
	timelineFps: number
): Partial<TimelineItem> {
	const durationInFrames =
		handle === 'start' ? item.durationInFrames - amount : item.durationInFrames + amount;
	const patch: Partial<TimelineItem> =
		handle === 'start' ? { from: item.from + amount, durationInFrames } : { durationInFrames };
	const sourceUpdate = calculateTrimSourceUpdate(
		item,
		handle,
		amount,
		durationInFrames,
		timelineFps
	);
	if (sourceUpdate) Object.assign(patch, sourceUpdate);
	return patch;
}

export function planTrimGesture(
	item: TimelineItem,
	handle: TrimHandle,
	deltaTimelineFrames: number,
	allItems: TimelineItem[],
	timelineFps: number,
	snapTargets: SnapTarget[],
	snapThresholdFrames: number
): TrimGesturePlan {
	const originalEdge = handle === 'start' ? item.from : item.from + item.durationInFrames;
	const snap = calculateEdgeSnap(
		originalEdge + deltaTimelineFrames,
		snapTargets,
		snapThresholdFrames
	);
	let amount = snap.snappedFrame - originalEdge;
	amount = clampTrimAmount(item, handle, amount, timelineFps).clampedAmount;
	amount = clampToAdjacentItems(item, handle, amount, allItems);
	const finalEdge = originalEdge + amount;
	const snapTarget = snap.snapTarget?.frame === finalEdge ? snap.snapTarget : null;
	return { patch: trimPatchForAmount(item, handle, amount, timelineFps), snapTarget };
}

export function planRollingTrimGesture(
	left: TimelineItem,
	right: TimelineItem,
	deltaTimelineFrames: number,
	allItems: TimelineItem[],
	timelineFps: number,
	snapTargets: SnapTarget[],
	snapThresholdFrames: number
): RollingTrimGesturePlan | null {
	const editPoint = left.from + left.durationInFrames;
	if (left.trackId !== right.trackId || right.from !== editPoint) return null;
	const snap = calculateEdgeSnap(editPoint + deltaTimelineFrames, snapTargets, snapThresholdFrames);
	let amount = snap.snappedFrame - editPoint;
	amount = tighterDelta(amount, clampTrimAmount(left, 'end', amount, timelineFps).clampedAmount);
	amount = tighterDelta(amount, clampTrimAmount(right, 'start', amount, timelineFps).clampedAmount);
	amount = tighterDelta(
		amount,
		clampToAdjacentItems(left, 'end', amount, allItems, new Set([right.id]))
	);
	amount = tighterDelta(
		amount,
		clampToAdjacentItems(right, 'start', amount, allItems, new Set([left.id]))
	);
	const finalEditPoint = editPoint + amount;
	return {
		leftPatch: trimPatchForAmount(left, 'end', amount, timelineFps),
		rightPatch: trimPatchForAmount(right, 'start', amount, timelineFps),
		snapTarget: snap.snapTarget?.frame === finalEditPoint ? snap.snapTarget : null
	};
}

export function planSlipGesture(
	item: TimelineItem,
	deltaTimelineFrames: number,
	timelineFps: number
): Pick<TimelineItem, 'sourceStart' | 'sourceEnd'> | null {
	if (item.type !== 'video' && item.type !== 'audio') return null;
	const { sourceStart, sourceEnd, sourceDuration, sourceFps, speed } = getSourceProperties(item);
	if (sourceEnd === undefined) return null;
	const effectiveSourceFps = sourceFps ?? timelineFps;
	const windowFrames = Math.max(1, sourceEnd - sourceStart);
	const requestedDelta = timelineToSourceFrames(
		-deltaTimelineFrames,
		speed,
		timelineFps,
		effectiveSourceFps
	);
	const maxStart = Math.max(0, (sourceDuration ?? sourceEnd) - windowFrames);
	const nextStart = Math.min(Math.max(sourceStart + requestedDelta, 0), maxStart);
	return { sourceStart: nextStart, sourceEnd: nextStart + windowFrames };
}
