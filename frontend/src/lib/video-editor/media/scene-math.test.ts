import { describe, expect, it } from 'vitest';
import { SCENE_CELL_SIZE, cutFramesForItem, lumaGridHistogram } from './scene-math';

function solidRgba(
	width: number,
	height: number,
	r: number,
	g: number,
	b: number
): Uint8ClampedArray {
	const pixels = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		pixels[i * 4] = r;
		pixels[i * 4 + 1] = g;
		pixels[i * 4 + 2] = b;
		pixels[i * 4 + 3] = 255;
	}
	return pixels;
}

describe('lumaGridHistogram', () => {
	it('produces buckets that sum to 1 for a uniform frame', () => {
		const width = SCENE_CELL_SIZE * 6;
		const height = SCENE_CELL_SIZE * 3;
		const buckets = lumaGridHistogram(solidRgba(width, height, 128, 128, 128), width, height);
		expect(buckets.length).toBe(18);
		const total = buckets.reduce((sum, value) => sum + value, 0);
		expect(total).toBeCloseTo(1, 6);
		for (const bucket of buckets) expect(bucket).toBeCloseTo(1 / 18, 6);
	});

	it('weights bright regions heavier than dark ones', () => {
		const width = 32;
		const height = 18;
		const pixels = solidRgba(width, height, 0, 0, 0);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < Math.floor(width / 2); x++) {
				const index = (y * width + x) * 4;
				pixels[index] = 255;
				pixels[index + 1] = 255;
				pixels[index + 2] = 255;
			}
		}
		const buckets = lumaGridHistogram(pixels, width, height);
		expect(buckets[0]!).toBeGreaterThan(buckets[buckets.length - 1]!);
	});

	it('returns zeroed buckets for a fully transparent frame', () => {
		const buckets = lumaGridHistogram(new Uint8ClampedArray(32 * 18 * 4), 32, 18);
		expect(buckets.length).toBe(18);
		expect(buckets.every((bucket) => bucket === 0)).toBe(true);
	});
});

describe('cutFramesForItem', () => {
	it('maps source frames onto timeline positions', () => {
		const frames = cutFramesForItem({
			cutSourceFrames: [30, 90],
			sourceFps: 30,
			from: 100,
			timelineFps: 30
		});
		expect(frames).toEqual([130, 190]);
	});

	it('accounts for source offset and playback speed', () => {
		const frames = cutFramesForItem({
			cutSourceFrames: [60],
			sourceFps: 30,
			sourceStart: 30,
			speed: 2,
			from: 50,
			timelineFps: 30
		});
		// 1s of source (frames 30→60) plays in 0.5s at 2× — 15 timeline frames.
		expect(frames).toEqual([65]);
	});

	it('falls back to the timeline fps when the source fps is unusable', () => {
		const frames = cutFramesForItem({
			cutSourceFrames: [10],
			sourceFps: 0,
			from: 0,
			timelineFps: 20
		});
		expect(frames).toEqual([10]);
	});
});
