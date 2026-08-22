import { describe, expect, it } from 'vitest';
import { PROXY_MAX_HEIGHT, proxyDimensions } from './proxy-client';

describe('proxyDimensions', () => {
	it('caps height at the max while preserving aspect ratio', () => {
		const size = proxyDimensions(1920, 1080);
		expect(size.height).toBeLessThanOrEqual(PROXY_MAX_HEIGHT);
		expect(size.width / size.height).toBeCloseTo(1920 / 1080, 2);
	});

	it('keeps even dimensions for codec compatibility', () => {
		expect(proxyDimensions(1919, 1079).width % 2).toBe(0);
		expect(proxyDimensions(1919, 1079).height % 2).toBe(0);
	});

	it('never upscales smaller footage', () => {
		expect(proxyDimensions(640, 360)).toEqual({ width: 640, height: 360 });
	});

	it('returns zeroed dimensions for unusable input', () => {
		expect(proxyDimensions(0, 0)).toEqual({ width: 0, height: 0 });
	});
});
