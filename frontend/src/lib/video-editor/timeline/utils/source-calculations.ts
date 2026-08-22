/**
 * Core utilities for source/timeline frame conversions.
 *
 * Terminology:
 * - Timeline frames: frames as they appear on the timeline (affected by speed)
 * - Source frames: actual frames in the source media file
 * - Speed: playback rate (1 = normal, 2 = 2x faster, 0.5 = half speed)
 *
 * Relationships:
 * - sourceFrames = timelineFrames * speed
 * - timelineFrames = sourceFrames / speed
 *
 * Ported from FreeCut (MIT) — utils/source-calculations.ts — trimmed to the
 * v1 surface (video/audio only; no compositions, no reverse playback).
 */

import type { TimelineItemKind } from '../../project/types';

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 16;
export const DEFAULT_SPEED = 1;
const DEFAULT_TIMELINE_FPS = 30;

/** Minimal structural view of a timeline item needed for frame math. */
export interface SourceCalculationItem {
	type: TimelineItemKind;
	sourceStart?: number;
	sourceEnd?: number;
	sourceDuration?: number;
	sourceFps?: number;
	speed?: number;
}

function normalizeFps(fps: number | undefined, fallback: number): number {
	if (fps === undefined || !Number.isFinite(fps) || fps <= 0) return fallback;
	return fps;
}

export interface SourceProperties {
	sourceStart: number;
	sourceEnd: number | undefined;
	sourceDuration: number | undefined;
	sourceFps: number | undefined;
	speed: number;
}

/** Extract source properties from a media item with defaults. */
export function getSourceProperties(item: SourceCalculationItem): SourceProperties {
	if (item.type !== 'video' && item.type !== 'audio') {
		return {
			sourceStart: 0,
			sourceEnd: undefined,
			sourceDuration: undefined,
			sourceFps: undefined,
			speed: DEFAULT_SPEED
		};
	}

	return {
		sourceStart: item.sourceStart ?? 0,
		sourceEnd: item.sourceEnd,
		sourceDuration: item.sourceDuration,
		sourceFps: item.sourceFps,
		speed: item.speed ?? DEFAULT_SPEED
	};
}

/** Convert timeline frames to source frames. Rounds to minimize float error. */
export function timelineToSourceFrames(
	timelineFrames: number,
	speed: number,
	timelineFps: number = DEFAULT_TIMELINE_FPS,
	sourceFps: number = timelineFps
): number {
	const safeTimelineFps = normalizeFps(timelineFps, DEFAULT_TIMELINE_FPS);
	const safeSourceFps = normalizeFps(sourceFps, safeTimelineFps);
	const timelineSeconds = timelineFrames / safeTimelineFps;
	return Math.round(timelineSeconds * safeSourceFps * speed);
}

/** Convert source frames to timeline frames. Floors so we never exceed source bounds. */
export function sourceToTimelineFrames(
	sourceFrames: number,
	speed: number,
	sourceFps: number = DEFAULT_TIMELINE_FPS,
	timelineFps: number = sourceFps
): number {
	const safeSourceFps = normalizeFps(sourceFps, DEFAULT_TIMELINE_FPS);
	const safeTimelineFps = normalizeFps(timelineFps, safeSourceFps);
	const sourceSeconds = sourceFrames / safeSourceFps;
	return Math.floor((sourceSeconds * safeTimelineFps) / speed);
}

/** Available source frames from `sourceStart` to the end of the media. */
export function getAvailableSourceFrames(sourceDuration: number, sourceStart: number): number {
	return Math.max(0, sourceDuration - sourceStart);
}

/** Max timeline duration based on available source frames. */
export function getMaxTimelineDuration(
	sourceDuration: number,
	sourceStart: number,
	speed: number,
	sourceFps: number = DEFAULT_TIMELINE_FPS,
	timelineFps: number = sourceFps
): number {
	const available = getAvailableSourceFrames(sourceDuration, sourceStart);
	return sourceToTimelineFrames(available, speed, sourceFps, timelineFps);
}

/** Max extension towards the source start (in timeline frames). */
export function getMaxStartExtension(
	sourceStart: number,
	speed: number,
	sourceFps: number = DEFAULT_TIMELINE_FPS,
	timelineFps: number = sourceFps
): number {
	return sourceToTimelineFrames(sourceStart, speed, sourceFps, timelineFps);
}

/** Calculate speed from source duration and desired timeline duration. */
export function calculateSpeed(
	sourceDuration: number,
	timelineDuration: number,
	sourceFps: number = DEFAULT_TIMELINE_FPS,
	timelineFps: number = sourceFps
): number {
	if (timelineDuration <= 0) return DEFAULT_SPEED;
	const safeSourceFps = normalizeFps(sourceFps, DEFAULT_TIMELINE_FPS);
	const safeTimelineFps = normalizeFps(timelineFps, safeSourceFps);
	return (sourceDuration * safeTimelineFps) / (timelineDuration * safeSourceFps);
}

/**
 * Clamp speed to the valid range without rounding. Speed is stored with full
 * precision for accurate calculations; UI formats for display only.
 */
export function clampSpeed(speed: number): number {
	return Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed));
}

/** A media item is one with source boundaries (video or audio). */
export function isMediaItem(item: SourceCalculationItem): boolean {
	return item.type === 'video' || item.type === 'audio';
}

export interface SplitSourceBoundaries {
	left: { sourceEnd: number };
	right: { sourceStart: number; sourceEnd: number };
}

/** Calculate source boundaries for split items (left keeps the start). */
export function calculateSplitSourceBoundaries(
	sourceStart: number,
	leftDuration: number,
	rightDuration: number,
	speed: number,
	timelineFps: number = DEFAULT_TIMELINE_FPS,
	sourceFps: number = timelineFps
): SplitSourceBoundaries {
	const leftSourceFrames = timelineToSourceFrames(leftDuration, speed, timelineFps, sourceFps);
	const totalSourceFrames = timelineToSourceFrames(
		leftDuration + rightDuration,
		speed,
		timelineFps,
		sourceFps
	);

	return {
		left: { sourceEnd: sourceStart + leftSourceFrames },
		right: {
			sourceStart: sourceStart + leftSourceFrames,
			sourceEnd: sourceStart + totalSourceFrames
		}
	};
}
