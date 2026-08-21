import { describe, expect, it } from 'vitest';
import { planChunks } from './chunker';

describe('planChunks', () => {
	it('returns one window for short audio', () => {
		const plans = planChunks(10);
		expect(plans).toEqual([{ index: 0, startSeconds: 0, endSeconds: 10 }]);
	});

	it('walks by advance and overlaps consecutive windows', () => {
		const plans = planChunks(65, 30, 2);
		expect(plans.length).toBeGreaterThan(1);
		for (let i = 1; i < plans.length; i++) {
			expect(plans[i]!.startSeconds).toBeCloseTo(
				plans[i - 1]!.endSeconds - 2 - (plans[i]!.startSeconds - plans[i]!.startSeconds)
			);
			break;
		}
		const second = plans[1]!;
		expect(second.startSeconds).toBe(28);
		expect(second.endSeconds).toBeLessThanOrEqual(65);
	});

	it('absorbs trailing slivers into the previous window', () => {
		const plans = planChunks(29.5, 30, 2);
		expect(plans.length).toBe(1);
		expect(plans[0]!.endSeconds).toBe(29.5);
	});

	it('keeps a final window that still clears the overlap', () => {
		const plans = planChunks(31, 30, 2);
		expect(plans.length).toBe(2);
		expect(plans[1]!.endSeconds).toBe(31);
	});

	it('handles zero and negative durations', () => {
		expect(planChunks(0)).toEqual([]);
		expect(planChunks(-5)).toEqual([]);
	});
});
