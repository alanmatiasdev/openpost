/**
 * Pure math for scene-cut scanning: frame-grid histogram building and
 * cut-position mapping. Kept free of mediabunny/DOM types so it can be
 * unit-tested directly.
 *
 * Ported from FreeCut (MIT) — scene-sampling concept: downscale sampled
 * frames and compare average-luma grids between consecutive samples.
 */

import type { FrameHistogram } from './scene-detection';

/** Seconds between sampled frames (~4 fps). */
export const SCENE_SAMPLE_INTERVAL_SECONDS = 0.25;

export const SCENE_GRID_WIDTH = 32;
export const SCENE_GRID_HEIGHT = 18;
/** Grid cells are CELL×CELL blocks of the downscaled frame (6×3 cells). */
export const SCENE_CELL_SIZE = 6;
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/**
 * Build one histogram from RGBA pixel data of a `width × height` frame:
 * average luma per grid cell, normalized so the buckets sum to 1.
 */
export function lumaGridHistogram(
	pixels: Uint8ClampedArray,
	width: number,
	height: number
): FrameHistogram['buckets'] {
	const cols = Math.max(1, Math.ceil(width / SCENE_CELL_SIZE));
	const rows = Math.max(1, Math.ceil(height / SCENE_CELL_SIZE));
	const sums = new Float64Array(cols * rows);
	for (let y = 0; y < height; y++) {
		const row = Math.min(rows - 1, Math.floor(y / SCENE_CELL_SIZE));
		for (let x = 0; x < width; x++) {
			const col = Math.min(cols - 1, Math.floor(x / SCENE_CELL_SIZE));
			const index = (y * width + x) * 4;
			sums[row * cols + col] +=
				LUMA_R * pixels[index]! + LUMA_G * pixels[index + 1]! + LUMA_B * pixels[index + 2]!;
		}
	}
	let total = 0;
	for (const value of sums) total += value;
	if (!(total > 0)) return new Array<number>(cols * rows).fill(0);
	return Array.from(sums, (value) => value / total);
}

export interface CutFrameMapping {
	/** Cut positions in the media's own source frames. */
	cutSourceFrames: number[];
	sourceFps: number;
	sourceStart?: number;
	speed?: number;
	from: number;
	timelineFps: number;
}

/**
 * Map source-frame cut positions onto timeline frames within one item,
 * inverting the same source-window math `_splitItem` uses when it shifts
 * the right piece.
 */
export function cutFramesForItem(mapping: CutFrameMapping): number[] {
	const speed = mapping.speed && mapping.speed > 0 ? mapping.speed : 1;
	const sourceFps = mapping.sourceFps > 0 ? mapping.sourceFps : mapping.timelineFps;
	const sourceStart = mapping.sourceStart ?? 0;
	return mapping.cutSourceFrames.map(
		(sourceFrame) =>
			mapping.from +
			Math.round(((sourceFrame - sourceStart) / sourceFps / speed) * mapping.timelineFps)
	);
}
