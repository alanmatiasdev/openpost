import { describe, expect, it } from 'vitest';
import { buildScopeBins } from './scopes';

describe('scope bins', () => {
	it('places black and white at the matching histogram ends', () => {
		const bins = buildScopeBins(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1);
		expect(bins.histogram.luma[0]).toBe(1);
		expect(bins.histogram.luma[255]).toBe(1);
	});
});
