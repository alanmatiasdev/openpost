import { describe, expect, it } from 'vitest';
import { isProResCodec } from './prores-decoder';

describe('ProRes decoder routing', () => {
	it('loads the custom decoder only for Mediabunny ProRes tracks', () => {
		expect(isProResCodec('prores')).toBe(true);
		expect(isProResCodec(' ProRes ')).toBe(true);
		expect(isProResCodec('avc')).toBe(false);
		expect(isProResCodec(undefined)).toBe(false);
	});
});
