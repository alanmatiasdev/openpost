import { describe, expect, it } from 'vitest';
import { getSpatialPointEffectConfig, SPATIAL_POINT_EFFECT_IDS } from './spatial-point-editor';

describe('spatial point effect configuration', () => {
	it.each([
		'gpu-twirl',
		'gpu-bulge',
		'gpu-trigger-wave',
		'gpu-radial-blur',
		'gpu-zoom-blur',
		'gpu-droste'
	])('maps %s to center parameters', (effectType) => {
		expect(getSpatialPointEffectConfig(effectType)).toEqual({
			xParam: 'centerX',
			yParam: 'centerY'
		});
	});

	it('maps ripple glass to its origin parameters', () => {
		expect(getSpatialPointEffectConfig('gpu-ripple-glass')).toEqual({
			xParam: 'originX',
			yParam: 'originY'
		});
	});

	it('exposes exactly the seven shader-backed point effects', () => {
		expect(SPATIAL_POINT_EFFECT_IDS).toHaveLength(7);
		expect(getSpatialPointEffectConfig('gpu-dither')).toBeNull();
	});
});
