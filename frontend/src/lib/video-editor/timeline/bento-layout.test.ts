import { describe, expect, it } from 'vitest';
import type { TimelineTransition } from '../project/types';
import {
	buildBentoTransitionChains,
	computeBentoLayout,
	computeGridDimensions
} from './bento-layout';

const items = (count: number) =>
	Array.from({ length: count }, (_, index) => ({
		id: String.fromCharCode(97 + index),
		sourceWidth: 1920,
		sourceHeight: 1080
	}));

describe('Bento layout math', () => {
	it('chooses compact automatic grids and contains source aspect ratios', () => {
		expect(computeGridDimensions(0)).toEqual({ cols: 0, rows: 0 });
		expect(computeGridDimensions(5)).toEqual({ cols: 3, rows: 2 });
		const result = computeBentoLayout(
			[
				{ id: 'wide', sourceWidth: 1920, sourceHeight: 1080 },
				{ id: 'tall', sourceWidth: 400, sourceHeight: 800 }
			],
			1280,
			720,
			{ preset: 'auto', gap: 20, padding: 40 }
		);
		expect(result.get('wide')).toMatchObject({ x: -305, width: 590, rotation: 0 });
		expect(result.get('tall')?.height).toBe(640);
		expect(result.get('tall')?.width).toBe(320);
	});

	it('supports row, column, picture-in-picture, focus sidebar, and bounded fixed grids', () => {
		const row = computeBentoLayout(items(3), 1280, 720, { preset: 'row' });
		expect(row.get('a')?.y).toBe(row.get('c')?.y);
		expect(row.get('a')!.x!).toBeLessThan(row.get('c')!.x!);

		const column = computeBentoLayout(items(3), 1280, 720, { preset: 'column' });
		expect(column.get('a')?.x).toBe(column.get('c')?.x);
		expect(column.get('a')!.y!).toBeLessThan(column.get('c')!.y!);

		const pip = computeBentoLayout(items(3), 1280, 720, { preset: 'pip', gap: 8 });
		expect(pip.get('a')).toMatchObject({ x: 0, y: 0, width: 1280, height: 720 });
		expect(pip.get('b')!.x!).toBeGreaterThan(0);
		expect(pip.get('b')!.width!).toBeLessThanOrEqual(320);

		const focus = computeBentoLayout(items(3), 1280, 720, {
			preset: 'focus-sidebar',
			gap: 8
		});
		expect(focus.get('a')!.width!).toBeGreaterThan(focus.get('b')!.width!);
		expect(focus.get('b')?.x).toBe(focus.get('c')?.x);

		const grid = computeBentoLayout(items(5), 1280, 720, {
			preset: 'grid',
			cols: 2,
			rows: 2
		});
		expect(grid.get('e')!.y!).toBeLessThanOrEqual(360);
	});

	it('clamps unsafe spacing instead of producing negative or non-finite geometry', () => {
		for (const preset of ['grid', 'focus-sidebar'] as const) {
			const result = computeBentoLayout(items(8), 100, 80, {
				preset,
				cols: -8,
				rows: Number.NaN,
				gap: 500,
				padding: 500
			});
			for (const transform of result.values()) {
				for (const value of [transform.x, transform.y, transform.width, transform.height]) {
					expect(Number.isFinite(value)).toBe(true);
				}
				expect(transform.width).toBeGreaterThanOrEqual(1);
				expect(transform.height).toBeGreaterThanOrEqual(1);
				expect((transform.x ?? 0) - (transform.width ?? 0) / 2).toBeGreaterThanOrEqual(-50);
				expect((transform.x ?? 0) + (transform.width ?? 0) / 2).toBeLessThanOrEqual(50);
				expect((transform.y ?? 0) - (transform.height ?? 0) / 2).toBeGreaterThanOrEqual(-40);
				expect((transform.y ?? 0) + (transform.height ?? 0) / 2).toBeLessThanOrEqual(40);
			}
		}
	});
});

describe('buildBentoTransitionChains', () => {
	it('keeps selected transition runs in one layout cell and terminates cycles', () => {
		const transition = (fromItemId: string, toItemId: string): TimelineTransition => ({
			id: `${fromItemId}-${toItemId}`,
			type: 'crossfade',
			durationInFrames: 10,
			fromItemId,
			toItemId
		});
		expect(
			buildBentoTransitionChains(
				['b', 'a', 'c', 'solo'],
				[transition('a', 'b'), transition('b', 'c')]
			)
		).toEqual([['a', 'b', 'c'], ['solo']]);
		expect(
			buildBentoTransitionChains(['a', 'b'], [transition('a', 'b'), transition('b', 'a')]).flat()
		).toEqual(expect.arrayContaining(['a', 'b']));
	});
});
