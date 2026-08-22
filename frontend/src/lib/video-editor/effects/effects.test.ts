import { describe, expect, it } from 'vitest';
import type { ItemEffect } from './types';
import { effectsToCssFilter } from './filter';

function effect(type: Exclude<ItemEffect['type'], 'gpu'>, amount: number): ItemEffect {
	return { id: `${type}-1`, type, amount, enabled: true };
}

describe('effectsToCssFilter', () => {
	it('returns an empty string for undefined or empty lists', () => {
		expect(effectsToCssFilter(undefined)).toBe('');
		expect(effectsToCssFilter([])).toBe('');
	});

	it('serializes unit-less color effects', () => {
		expect(effectsToCssFilter([effect('brightness', 1.2)])).toBe('brightness(1.2)');
		expect(effectsToCssFilter([effect('contrast', 0.8), effect('saturation', 1.5)])).toBe(
			'contrast(0.8) saturation(1.5)'
		);
	});

	it('appends degree units to hue-rotate and pixel units to blur', () => {
		expect(effectsToCssFilter([effect('hue-rotate', 90)])).toBe('hue-rotate(90deg)');
		expect(effectsToCssFilter([effect('blur', 4)])).toBe('blur(4px)');
	});

	it('serializes alpha-style effects between 0 and 1', () => {
		expect(
			effectsToCssFilter([effect('sepia', 0.5), effect('grayscale', 1), effect('invert', 0.25)])
		).toBe('sepia(0.5) grayscale(1) invert(0.25)');
	});

	it('skips disabled effects but keeps enabled ones in order', () => {
		const effects: ItemEffect[] = [
			effect('sepia', 0.5),
			{ ...effect('blur', 2), enabled: false },
			effect('contrast', 1.3)
		];
		expect(effectsToCssFilter(effects)).toBe('sepia(0.5) contrast(1.3)');
	});

	it('returns an empty string when every effect is disabled', () => {
		const effects: ItemEffect[] = [{ ...effect('invert', 1), enabled: false }];
		expect(effectsToCssFilter(effects)).toBe('');
	});
});
