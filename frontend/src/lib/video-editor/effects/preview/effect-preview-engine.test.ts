import { describe, expect, it } from 'vitest';
import { getGpuEffect } from '../gpu/registry';
import {
	blendGpuPreviewParams,
	cssPreviewFilter,
	getShowcaseParams
} from './effect-preview-engine';

describe('effect preview engine', () => {
	it('turns identity GPU defaults into visible showcase values', () => {
		const definition = getGpuEffect('gpu-brightness');
		expect(definition).toBeDefined();
		if (!definition) throw new Error('brightness definition missing');

		const target = getShowcaseParams(definition);
		expect(target.amount).toBeGreaterThan(0);
		expect(blendGpuPreviewParams(definition.id, target, 0).amount).toBe(0);
		expect(blendGpuPreviewParams(definition.id, target, 1)).toEqual(target);
	});

	it('sweeps CSS filters from their real identity values', () => {
		expect(cssPreviewFilter('brightness', 1.2, 0)).toBe('brightness(1)');
		expect(cssPreviewFilter('brightness', 1.2, 1)).toBe('brightness(1.2)');
		expect(cssPreviewFilter('hue-rotate', 45, 0)).toBe('hue-rotate(0deg)');
		expect(cssPreviewFilter('blur', 4, 0.5)).toBe('blur(2px)');
	});
});
