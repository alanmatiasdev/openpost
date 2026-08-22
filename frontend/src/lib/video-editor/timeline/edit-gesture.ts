/** Pure edit plans for live timeline pointer and keyboard gestures. */

import type { TimelineItem } from '../project/types';
import {
	calculateTrimSourceUpdate,
	clampToAdjacentItems,
	clampTrimAmount,
	type TrimHandle
} from './utils/trim-utils';
import {
	calculateSpeed,
	MAX_SPEED,
	MIN_SPEED,
	getSourceProperties,
	sourceToTimelineFrames,
	timelineToSourceFrames
} from './utils/source-calculations';
import { calculateEdgeSnap, calculateMoveSnap, type SnapTarget } from './snapping';

export interface TrimGesturePlan {
	patch: Partial<TimelineItem>;
	snapTarget: SnapTarget | null;
}

export interface RollingTrimGesturePlan {
	leftPatch: Partial<TimelineItem>;
	rightPatch: Partial<TimelineItem>;
	snapTarget: SnapTarget | null;
}

export interface SlideGesturePlan {
	itemPatch: Partial<TimelineItem>;
	leftPatch: Partial<TimelineItem> | null;
	rightPatch: Partial<TimelineItem> | null;
	snapTarget: SnapTarget | null;
}

export interface RateStretchGesturePlan {
	patch: Partial<TimelineItem>;
	moves: Array<{ id: string; from: number }>;
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
	const maxStart =
		sourceDuration === undefined
			? Number.POSITIVE_INFINITY
			: Math.max(0, sourceDuration - windowFrames);
	const nextStart = Math.min(Math.max(sourceStart + requestedDelta, 0), maxStart);
	return { sourceStart: nextStart, sourceEnd: nextStart + windowFrames };
}

function canJoinForSlide(left: TimelineItem, right: TimelineItem): boolean {
	if (!left.originId || left.originId !== right.originId) return false;
	if (left.trackId !== right.trackId || !left.mediaId || left.mediaId !== right.mediaId)
		return false;
	if (left.from + left.durationInFrames !== right.from) return false;
	if ((left.speed ?? 1) !== (right.speed ?? 1)) return false;
	const leftSourceEnd = left.sourceEnd;
	const rightSourceStart = right.sourceStart ?? 0;
	return leftSourceEnd !== undefined && Math.abs(leftSourceEnd - rightSourceStart) <= 0.5;
}

function slideContinuityPatch(
	item: TimelineItem,
	left: TimelineItem | null,
	right: TimelineItem | null,
	deltaTimelineFrames: number,
	timelineFps: number
): Partial<TimelineItem> {
	if (
		!left ||
		!right ||
		!canJoinForSlide(left, item) ||
		!canJoinForSlide(item, right) ||
		item.sourceEnd === undefined
	) {
		return {};
	}
	const sourceStart = item.sourceStart ?? 0;
	const sourceEnd = item.sourceEnd;
	const sourceWindow = sourceEnd - sourceStart;
	const sourceDelta = timelineToSourceFrames(
		deltaTimelineFrames,
		item.speed ?? 1,
		timelineFps,
		item.sourceFps ?? timelineFps
	);
	const maxStart =
		item.sourceDuration === undefined
			? Number.POSITIVE_INFINITY
			: Math.max(0, item.sourceDuration - sourceWindow);
	const nextStart = Math.min(Math.max(sourceStart + sourceDelta, 0), maxStart);
	return { sourceStart: nextStart, sourceEnd: nextStart + sourceWindow };
}

export function planSlideGesture(
	item: TimelineItem,
	left: TimelineItem | null,
	right: TimelineItem | null,
	deltaTimelineFrames: number,
	allItems: TimelineItem[],
	timelineFps: number,
	snapTargets: SnapTarget[],
	snapThresholdFrames: number
): SlideGesturePlan {
	const snap = calculateMoveSnap(
		item.from + deltaTimelineFrames,
		item.durationInFrames,
		snapTargets,
		snapThresholdFrames
	);
	let amount = snap.snappedFrame - item.from;
	amount = tighterDelta(amount, Math.max(-item.from, amount));
	const excluded = new Set([item.id, left?.id ?? '', right?.id ?? '']);
	if (left) {
		amount = tighterDelta(amount, clampTrimAmount(left, 'end', amount, timelineFps).clampedAmount);
		amount = tighterDelta(amount, clampToAdjacentItems(left, 'end', amount, allItems, excluded));
	}
	if (right) {
		amount = tighterDelta(
			amount,
			clampTrimAmount(right, 'start', amount, timelineFps).clampedAmount
		);
		amount = tighterDelta(amount, clampToAdjacentItems(right, 'start', amount, allItems, excluded));
	}
	const finalFrom = item.from + amount;
	return {
		itemPatch: { from: finalFrom, ...slideContinuityPatch(item, left, right, amount, timelineFps) },
		leftPatch: left ? trimPatchForAmount(left, 'end', amount, timelineFps) : null,
		rightPatch: right ? trimPatchForAmount(right, 'start', amount, timelineFps) : null,
		snapTarget: snap.snappedFrame === finalFrom ? snap.snapTarget : null
	};
}

export function planRateStretchGesture(
	item: TimelineItem,
	deltaTimelineFrames: number,
	allItems: TimelineItem[],
	timelineFps: number,
	snapTargets: SnapTarget[],
	snapThresholdFrames: number
): RateStretchGesturePlan | null {
	if (item.type !== 'video' && item.type !== 'audio') return null;
	const sourceStart = item.sourceStart ?? 0;
	const sourceFrames =
		item.sourceEnd !== undefined
			? item.sourceEnd - sourceStart
			: (item.sourceDuration ?? sourceStart) - sourceStart;
	if (sourceFrames <= 0) return null;
	const sourceFps = item.sourceFps ?? timelineFps;
	const originalEnd = item.from + item.durationInFrames;
	const snap = calculateEdgeSnap(
		originalEnd + deltaTimelineFrames,
		snapTargets,
		snapThresholdFrames
	);
	const proposedDuration = snap.snappedFrame - item.from;
	const minDuration = Math.max(
		1,
		Math.ceil((sourceFrames * timelineFps) / (sourceFps * MAX_SPEED))
	);
	const maxDuration = Math.max(
		minDuration,
		sourceToTimelineFrames(sourceFrames, MIN_SPEED, sourceFps, timelineFps)
	);
	const durationInFrames = Math.min(
		Math.max(Math.round(proposedDuration), minDuration),
		maxDuration
	);
	const speed = calculateSpeed(sourceFrames, durationInFrames, sourceFps, timelineFps);
	const endDelta = durationInFrames - item.durationInFrames;
	return {
		patch: { durationInFrames, speed },
		moves: allItems
			.filter(
				(candidate) =>
					candidate.id !== item.id &&
					candidate.trackId === item.trackId &&
					candidate.from >= originalEnd
			)
			.map((candidate) => ({ id: candidate.id, from: candidate.from + endDelta })),
		snapTarget: item.from + durationInFrames === snap.snappedFrame ? snap.snapTarget : null
	};
}
