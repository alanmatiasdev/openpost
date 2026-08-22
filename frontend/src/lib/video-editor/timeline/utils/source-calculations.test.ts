import { describe, expect, it } from 'vitest';
import {
	MAX_SPEED,
	getClampedRateStretchSpeed,
	getRateStretchDurationLimits,
	resolveRateStretchDurationAndSpeed,
	timelineToSourceFrames
} from './source-calculations';

describe('rate-stretch source coverage', () => {
	it('uses a ceil-based minimum duration so max speed keeps every source frame', () => {
		const limits = getRateStretchDurationLimits(100, 30, 30);
		expect(limits.min).toBe(7);

		const speed = getClampedRateStretchSpeed(100, limits.min, 30, 30);
		expect(speed).toBeLessThanOrEqual(MAX_SPEED);
		expect(timelineToSourceFrames(limits.min, speed, 30, 30)).toBeGreaterThanOrEqual(100);
	});

	it('normalizes an over-fast duration without trimming the source span', () => {
		const resolved = resolveRateStretchDurationAndSpeed(100, 6, 30, 30);
		expect(resolved.duration).toBeGreaterThanOrEqual(7);
		expect(resolved.speed).toBeLessThanOrEqual(MAX_SPEED);
		expect(
			timelineToSourceFrames(resolved.duration, resolved.speed, 30, 30)
		).toBeGreaterThanOrEqual(100);
	});
});
