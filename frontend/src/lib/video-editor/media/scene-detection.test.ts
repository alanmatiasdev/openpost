import { describe, expect, it } from 'vitest';
import { detectSceneCuts } from './scene-detection';
import type { FrameHistogram } from './scene-detection';

function histogram(timeSeconds: number, buckets: number[]): FrameHistogram {
	return { timeSeconds, buckets };
}

describe('detectSceneCuts', () => {
	it('flags frames whose histogram diverges past the threshold', () => {
		const cuts = detectSceneCuts([
			histogram(0, [1, 0, 0]),
			histogram(0.5, [0.98, 0.01, 0.01]),
			histogram(1, [0, 0, 1])
		]);
		expect(cuts.length).toBe(1);
		expect(cuts[0]!.timeSeconds).toBe(1);
	});

	it('stays quiet on gradual drift below the threshold', () => {
		const cuts = detectSceneCuts(
			[histogram(0, [1, 0]), histogram(1, [0.9, 0.1]), histogram(2, [0.8, 0.2])],
			0.35
		);
		expect(cuts.length).toBe(0);
	});
});
