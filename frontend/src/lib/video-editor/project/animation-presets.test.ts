import { describe, expect, it } from 'vitest';
import type { AnimationPreset } from './types';
import { cloneAnimationPreset, normalizeAnimationPresets } from './animation-presets';

function preset(): AnimationPreset {
	return {
		id: 'preset',
		name: 'Reveal',
		sourceItemType: 'video',
		properties: [
			{
				property: 'opacity',
				keyframes: [{ id: 'key', frame: 0, value: 1, easing: 'linear' }]
			}
		],
		effects: [],
		sourceDurationInFrames: 30,
		createdAt: 1
	};
}

describe('animation preset project data', () => {
	it('normalizes a valid project round trip', () => {
		expect(normalizeAnimationPresets([preset()])).toEqual([preset()]);
	});

	it('deep clones nested recipe data', () => {
		const original = preset();
		original.properties[0]!.keyframes[0]!.easingConfig = {
			type: 'cubic-bezier',
			bezier: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 }
		};
		const clone = cloneAnimationPreset(original);
		clone.properties[0]!.keyframes[0]!.value = 9;
		clone.properties[0]!.keyframes[0]!.easingConfig!.bezier!.x1 = 0.9;
		expect(original.properties[0]!.keyframes[0]!.value).toBe(1);
		expect(original.properties[0]!.keyframes[0]!.easingConfig!.bezier!.x1).toBe(0.1);
	});

	it('deep clones text motion slots', () => {
		const original = preset();
		original.sourceItemType = 'text';
		original.textMotion = {
			in: {
				presetId: 'rise',
				durationFrames: 14,
				staggerFrames: 4,
				intensity: 1,
				order: 'forward',
				easing: 'ease-out',
				seed: 0
			}
		};
		const clone = cloneAnimationPreset(original);
		clone.textMotion!.in!.intensity = 0.4;
		expect(original.textMotion.in!.intensity).toBe(1);
	});
});
