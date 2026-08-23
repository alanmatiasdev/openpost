/**
 * Ported from FreeCut (MIT) - animatable-properties and animated item resolver tests.
 */
import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { getAnimatablePropertiesForItem, resolveAnimatedItemAt } from './animated-properties';

function item(type: TimelineItem['type']): TimelineItem {
	return {
		id: 'item',
		trackId: 'track',
		from: 100,
		durationInFrames: 60,
		label: '',
		type
	};
}

describe('animatable properties', () => {
	it('exposes transform, crop, and volume lanes for video', () => {
		expect(getAnimatablePropertiesForItem(item('video'))).toEqual([
			'x',
			'y',
			'width',
			'height',
			'anchorX',
			'anchorY',
			'rotation',
			'opacity',
			'cornerRadius',
			'cropLeft',
			'cropRight',
			'cropTop',
			'cropBottom',
			'cropSoftness',
			'volume'
		]);
	});

	it('exposes typography lanes only on text items', () => {
		const properties = getAnimatablePropertiesForItem(item('text'));
		expect(properties).toContain('fontSize');
		expect(properties).toContain('textShadowBlur');
		expect(properties).toContain('strokeWidth');
		expect(properties).not.toContain('volume');
		expect(properties).not.toContain('cropLeft');
	});
});

describe('resolveAnimatedItemAt', () => {
	it('resolves nested transform, crop, audio, and text fields at one absolute frame', () => {
		const video: TimelineItem = {
			...item('video'),
			transform: { x: 10, opacity: 1 },
			crop: { top: 0, right: 0, bottom: 0, left: 0 },
			keyframes: {
				x: { frames: [0, 30], values: [10, 70] },
				opacity: { frames: [0, 30], values: [1, 0] },
				cropLeft: { frames: [0, 30], values: [0, 100] }
			}
		};
		const text: TimelineItem = {
			...item('text'),
			fontSize: 40,
			textShadow: { blur: 0, color: '#000000', offsetX: 0, offsetY: 0 },
			keyframes: {
				fontSize: { frames: [0, 30], values: [40, 80] },
				textShadowBlur: { frames: [0, 30], values: [0, 20] }
			}
		};

		const resolvedVideo = resolveAnimatedItemAt(video, 115);
		const resolvedText = resolveAnimatedItemAt(text, 115);

		expect(resolvedVideo.transform).toMatchObject({ x: 40, opacity: 0.5 });
		expect(resolvedVideo.crop?.left).toBe(50);
		expect(resolvedText.fontSize).toBe(60);
		expect(resolvedText.textShadow).toMatchObject({ blur: 10, color: '#000000' });
		expect(video.transform).toMatchObject({ x: 10, opacity: 1 });
	});

	it('uses coupled spatial position ahead of stale scalar X/Y tracks', () => {
		const video: TimelineItem = {
			...item('video'),
			transform: { x: 999, y: 999 },
			keyframes: {
				x: { frames: [0, 30], values: [-500, -500] },
				y: { frames: [0, 30], values: [-500, -500] }
			},
			vectorKeyframes: {
				position: [
					{
						id: 'start',
						frame: 0,
						value: { x: 0, y: 0 },
						easing: 'linear',
						spatial: {
							inTangent: { x: 0, y: -100 },
							outTangent: { x: 0, y: 100 }
						}
					},
					{
						id: 'end',
						frame: 30,
						value: { x: 60, y: 0 },
						easing: 'linear',
						spatial: {
							inTangent: { x: 0, y: 100 },
							outTangent: { x: 0, y: -100 }
						}
					}
				]
			}
		};

		expect(resolveAnimatedItemAt(video, 115).transform).toMatchObject({ x: 30, y: 75 });
	});
});
