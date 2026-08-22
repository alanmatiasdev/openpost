import { describe, expect, it } from 'vitest';
import { buildCurvesLut, evaluateMonotoneCurve } from './curves';

describe('GPU curves', () => {
	it('keeps an identity curve exact at the endpoints and midpoint', () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 0.25, y: 0.25 },
			{ x: 0.75, y: 0.75 },
			{ x: 1, y: 1 }
		];
		expect(evaluateMonotoneCurve(points, 0)).toBe(0);
		expect(evaluateMonotoneCurve(points, 0.5)).toBeCloseTo(0.5, 5);
		expect(evaluateMonotoneCurve(points, 1)).toBe(1);
	});

	it('builds a packed 256-pixel identity LUT', () => {
		const data = buildCurvesLut({});
		expect(data).toHaveLength(1024);
		expect([...data.slice(0, 4)]).toEqual([0, 0, 0, 255]);
		expect([...data.slice(-4)]).toEqual([255, 255, 255, 255]);
	});
});
