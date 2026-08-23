import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { captureAnimationFromItem, getAnimationPresetCompatibility } from './saved-animation';

function item(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'source',
		trackId: 'visual',
		from: 0,
		durationInFrames: 60,
		label: 'Source',
		type: 'video',
		...overrides
	};
}

describe('saved animation capture', () => {
	it('normalizes scalar and coupled keyframes to the earliest authored frame', () => {
		const preset = captureAnimationFromItem(
			item({
				keyframes: {
					opacity: {
						frames: [10, 30],
						values: [0, 1],
						ids: ['opacity-a', 'opacity-b'],
						easings: ['ease-in', 'linear']
					}
				},
				vectorKeyframes: {
					position: [{ id: 'position-a', frame: 20, value: { x: 1, y: 2 }, easing: 'linear' }]
				}
			}),
			'My move',
			123
		);
		expect(preset).toMatchObject({
			name: 'My move',
			sourceItemType: 'video',
			sourceDurationInFrames: 60,
			createdAt: 123,
			properties: [{ property: 'opacity', keyframes: [{ frame: 0 }, { frame: 20 }] }],
			vectorProperties: [{ property: 'position', keyframes: [{ frame: 10 }] }]
		});
	});

	it('carries every referenced same-type effect instance without collapsing them', () => {
		const preset = captureAnimationFromItem(
			item({
				effects: [
					{ id: 'glow-a', type: 'gpu', effectId: 'gpu-glow', enabled: true, params: {} },
					{ id: 'glow-b', type: 'gpu', effectId: 'gpu-glow', enabled: true, params: {} }
				],
				keyframes: {
					'effect:gpu-glow:glow-a:strength': { frames: [0], values: [0.2] },
					'effect:gpu-glow:glow-b:strength': { frames: [0], values: [0.8] }
				}
			}),
			'Two glows'
		);
		expect(preset?.effects.map((effect) => effect.id)).toEqual(['glow-a', 'glow-b']);
	});

	it('captures live behavior without requiring keyframes', () => {
		const preset = captureAnimationFromItem(
			item({
				motionModifiers: [
					{
						version: 2,
						id: 'spin',
						type: 'spin',
						enabled: true,
						amplitude: 1,
						frequency: 0.3,
						phaseFrames: 0,
						seed: 1
					}
				]
			}),
			'Live spin'
		);
		expect(preset?.motionModifiers).toMatchObject([{ type: 'spin' }]);
	});

	it('captures text motion without requiring keyframes', () => {
		const preset = captureAnimationFromItem(
			item({
				type: 'text',
				textMotion: {
					loop: {
						presetId: 'wave',
						durationFrames: 30,
						staggerFrames: 3,
						intensity: 1,
						order: 'forward',
						easing: 'linear',
						seed: 0
					}
				}
			}),
			'Text wave'
		);
		expect(preset?.textMotion?.loop?.presetId).toBe('wave');
	});

	it('blocks whole-preset application on a different clip type', () => {
		const preset = captureAnimationFromItem(
			item({ keyframes: { opacity: { frames: [0], values: [1] } } }),
			'Video only'
		)!;
		expect(getAnimationPresetCompatibility(preset, item({ type: 'image' }))).toEqual({
			compatible: false,
			reason: 'type-mismatch'
		});
	});
});
