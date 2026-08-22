import { describe, expect, it } from 'vitest';
import { encodeCubeLut } from './lut';

describe('cube LUT', () => {
	it('parses and packs a 2x2x2 identity LUT', () => {
		const encoded = encodeCubeLut(
			`LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1`
		);
		expect(encoded.size).toBe(2);
		expect(atob(encoded.data)).toHaveLength(32);
	});

	it('rejects incomplete LUTs', () => {
		expect(() => encodeCubeLut('LUT_3D_SIZE 2\n0 0 0')).toThrow(/Expected 8/);
	});
});
