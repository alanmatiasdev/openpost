import { describe, expect, it } from 'vitest';
import { nearestFilmstripFallback } from './scrub-proxy-fallback';

describe('nearestFilmstripFallback', () => {
	it('chooses the nearest usable frame inside the bounded drift window', () => {
		const frames = [
			{ index: 1, url: 'blob:one' },
			{ index: 2, url: null },
			{ index: 3, url: 'blob:three' }
		];
		expect(nearestFilmstripFallback(frames, 2.6)).toBe(frames[2]);
		expect(nearestFilmstripFallback(frames, 1.4)).toBe(frames[0]);
	});

	it('refuses stale, missing, and invalid fallback targets', () => {
		expect(nearestFilmstripFallback([{ index: 1, url: 'blob:one' }], 4)).toBeNull();
		expect(nearestFilmstripFallback([{ index: 1, url: null }], 1)).toBeNull();
		expect(nearestFilmstripFallback([{ index: 1, url: 'blob:one' }], Number.NaN)).toBeNull();
	});
});
