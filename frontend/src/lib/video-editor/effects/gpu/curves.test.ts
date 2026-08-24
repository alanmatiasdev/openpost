import { describe, expect, it } from 'vitest';
import {
	buildCurvesLut,
	curvePointsParamKey,
	evaluateMonotoneCurve,
	readCurveChannelPoints,
	sanitizeCurveChannelPoints,
	serializeCurveChannelPoints
} from './curves';

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

	it('sanitizes arbitrary points without dropping near-edge or dense controls', () => {
		const points = sanitizeCurveChannelPoints([
			{ x: 0.8, y: 2 },
			{ x: 0.21, y: 0.4 },
			{ x: 0.2, y: 0.2 },
			{ x: Number.NaN, y: 0.5 },
			{ x: 0.99, y: 0.7 }
		]);

		expect(points).toEqual([
			{ x: 0, y: 0 },
			{ x: 0.2, y: 0.2 },
			{ x: 0.24, y: 0.4 },
			{ x: 0.8, y: 1 },
			{ x: 0.96, y: 0.7 },
			{ x: 1, y: 1 }
		]);
		expect(
			points.every((point, index) => index === 0 || point.x - points[index - 1]!.x >= 0.04 - 1e-9)
		).toBe(true);
	});

	it('prefers stored multi-point channels and feeds them into the exact LUT', () => {
		const masterPoints = [
			{ x: 0, y: 0 },
			{ x: 0.5, y: 0.8 },
			{ x: 1, y: 1 }
		];
		const params = {
			[curvePointsParamKey('master')]: serializeCurveChannelPoints(masterPoints)
		};

		expect(readCurveChannelPoints(params, 'master')).toEqual(masterPoints);
		const data = buildCurvesLut(params);
		expect(data[128 * 4]).toBeGreaterThan(190);
		expect(data[128 * 4 + 1]).toBe(data[128 * 4]);
		expect(data[128 * 4 + 2]).toBe(data[128 * 4]);
	});

	it('falls back to legacy numeric controls when point JSON is malformed', () => {
		const points = readCurveChannelPoints(
			{ masterPoints: 'not-json', masterShadowY: 0.1, masterHighlightY: 0.9 },
			'master'
		);

		expect(points).toEqual([
			{ x: 0, y: 0 },
			{ x: 0.25, y: 0.1 },
			{ x: 0.75, y: 0.9 },
			{ x: 1, y: 1 }
		]);
	});
});
