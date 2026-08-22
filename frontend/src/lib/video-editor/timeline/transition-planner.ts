/** Cut-centered transition windows and source-handle validation. */

import type { TimelineItem, TimelineTransition } from '../project/types';
import {
	getAvailableSourceFrames,
	getSourceProperties,
	sourceToTimelineFrames
} from './utils/source-calculations';

export interface TransitionWindow {
	startFrame: number;
	endFrame: number;
	durationInFrames: number;
	leftPortion: number;
	rightPortion: number;
	cutFrame: number;
}

export interface TransitionPortions {
	leftPortion: number;
	rightPortion: number;
}

export function calculateTransitionPortions(
	durationInFrames: number,
	alignment: number | undefined
): TransitionPortions {
	const duration = Math.max(1, Math.floor(durationInFrames));
	const normalizedAlignment = Math.min(1, Math.max(0, alignment ?? 0.5));
	const leftPortion = Math.floor(duration * normalizedAlignment);
	return { leftPortion, rightPortion: duration - leftPortion };
}

export function resolveTransitionWindow(
	transition: TimelineTransition,
	left: TimelineItem,
	right: TimelineItem
): TransitionWindow | null {
	const leftEnd = left.from + left.durationInFrames;
	if (left.trackId !== right.trackId || Math.abs(leftEnd - right.from) > 1) return null;
	const cutFrame = right.from;
	const { leftPortion, rightPortion } = calculateTransitionPortions(
		transition.durationInFrames,
		transition.alignment
	);
	return {
		startFrame: cutFrame - leftPortion,
		endFrame: cutFrame + rightPortion,
		durationInFrames: leftPortion + rightPortion,
		leftPortion,
		rightPortion,
		cutFrame
	};
}

export function getAvailableTransitionHandle(
	item: TimelineItem,
	side: 'start' | 'end',
	timelineFps: number
): number {
	if (item.type === 'image' || item.type === 'text') return Number.POSITIVE_INFINITY;
	if (item.type !== 'video') return 0;
	const { sourceStart, sourceEnd, sourceDuration, sourceFps, speed } = getSourceProperties(item);
	const effectiveSourceFps = sourceFps ?? timelineFps;
	if (side === 'start') {
		return sourceToTimelineFrames(sourceStart, speed, effectiveSourceFps, timelineFps);
	}
	const availableAfter = getAvailableSourceFrames(
		sourceDuration ?? 0,
		sourceEnd ?? sourceDuration ?? 0
	);
	return sourceToTimelineFrames(availableAfter, speed, effectiveSourceFps, timelineFps);
}

export function canPreserveTransition(
	transition: TimelineTransition,
	left: TimelineItem,
	right: TimelineItem,
	timelineFps: number,
	maxCutGap = 1
): boolean {
	if (left.type !== 'video' && left.type !== 'image') return false;
	if (right.type !== 'video' && right.type !== 'image') return false;
	const leftEnd = left.from + left.durationInFrames;
	if (left.trackId !== right.trackId || Math.abs(leftEnd - right.from) > maxCutGap) return false;
	if (
		transition.durationInFrames <= 0 ||
		transition.durationInFrames >= Math.min(left.durationInFrames, right.durationInFrames)
	)
		return false;
	const { leftPortion, rightPortion } = calculateTransitionPortions(
		transition.durationInFrames,
		transition.alignment
	);
	return (
		leftPortion <= getAvailableTransitionHandle(right, 'start', timelineFps) &&
		rightPortion <= getAvailableTransitionHandle(left, 'end', timelineFps)
	);
}
