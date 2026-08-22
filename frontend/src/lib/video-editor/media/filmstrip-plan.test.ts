import { describe, expect, it } from 'vitest';
import {
	buildPriorityIndices,
	buildTargetIndices,
	computeFilmstripTiles,
	fitFilmstripFrameSize,
	getBackgroundStride,
	getTargetFrameBudget
} from './filmstrip-plan';

describe('fitFilmstripFrameSize', () => {
	it('preserves aspect ratio inside the budget', () => {
		const size = fitFilmstripFrameSize(1920, 1080, 178, 100);
		expect(size.height).toBe(100);
		expect(size.width).toBeCloseTo(178, 0);
	});

	it('falls back to the budget for unusable sources', () => {
		expect(fitFilmstripFrameSize(0, 0, 178, 100)).toEqual({ width: 178, height: 100 });
	});
});

describe('getTargetFrameBudget', () => {
	it('extracts every frame for short clips', () => {
		expect(getTargetFrameBudget(30)).toBe(30);
	});

	it('caps long clips at the sqrt-scaled budget', () => {
		const budget = getTargetFrameBudget(3600);
		expect(budget).toBeGreaterThanOrEqual(40);
		expect(budget).toBeLessThanOrEqual(72);
	});

	it('honors an explicit smaller target', () => {
		expect(getTargetFrameBudget(3600, 10)).toBe(10);
	});
});

describe('getBackgroundStride', () => {
	it('samples short clips densely and long clips sparsely', () => {
		// Thresholds are inclusive (<=), matching FreeCut.
		expect(getBackgroundStride(300)).toBe(1);
		expect(getBackgroundStride(301)).toBe(2);
		expect(getBackgroundStride(1201)).toBe(3);
		expect(getBackgroundStride(2401)).toBe(4);
	});
});

describe('buildTargetIndices', () => {
	it('always includes both endpoints', () => {
		const targets = buildTargetIndices(600, null);
		expect(targets[0]).toBe(0);
		expect(targets[targets.length - 1]).toBe(599);
	});

	it('stays within the budget for hour-long clips', () => {
		const targets = buildTargetIndices(3600, null);
		expect(targets.length).toBeLessThanOrEqual(getTargetFrameBudget(3600));
	});

	it('prioritizes the visible window densely', () => {
		const targets = buildTargetIndices(600, { startIndex: 10, endIndex: 20 });
		for (let i = 10; i < 20; i++) expect(targets).toContain(i);
	});

	it('returns everything for tiny clips regardless of range', () => {
		expect(buildTargetIndices(5, null)).toEqual([0, 1, 2, 3, 4]);
	});
});

describe('computeFilmstripTiles', () => {
	it('positions whole tiles at one-second pitch', () => {
		const frames = [
			{ index: 0, url: 'u0' },
			{ index: 1, url: 'u1' },
			{ index: 2, url: 'u2' }
		];
		const tiles = computeFilmstripTiles(frames, 0, 3, 300);
		expect(tiles.map((tile) => tile.x)).toEqual([0, 100, 200]);
		expect(tiles.every((tile) => tile.width === 100)).toBe(true);
	});

	it('clips tiles to the trimmed window', () => {
		const frames = [
			{ index: 0, url: null },
			{ index: 1, url: null }
		];
		const tiles = computeFilmstripTiles(frames, 0.5, 1.5, 150);
		expect(tiles).toHaveLength(2);
		expect(tiles[0]?.x).toBe(0);
		expect(tiles[0]?.width).toBe(50);
		expect(tiles[1]?.x).toBe(50);
		expect(tiles[1]?.width).toBe(100);
	});

	it('drops tiles outside the window and rejects unusable input', () => {
		const frames = [{ index: 5, url: null }];
		expect(computeFilmstripTiles(frames, 0, 2, 200)).toEqual([]);
		expect(computeFilmstripTiles(frames, 0, 0, 200)).toEqual([]);
		expect(computeFilmstripTiles(frames, 0, 2, 0)).toEqual([]);
	});
});

describe('buildPriorityIndices', () => {
	it('is empty without a range', () => {
		expect(buildPriorityIndices(100, null)).toEqual([]);
	});

	it('clamps out-of-bounds ranges', () => {
		const indices = buildPriorityIndices(50, { startIndex: -10, endIndex: 500 });
		expect(indices[0]).toBe(0);
		expect(indices[indices.length - 1]).toBe(49);
	});

	it('subsamples very wide ranges to the dense cap', () => {
		const indices = buildPriorityIndices(2000, { startIndex: 0, endIndex: 2000 }, 100);
		expect(indices.length).toBeLessThanOrEqual(101);
		expect(indices).toContain(0);
		expect(indices).toContain(1999);
	});
});
