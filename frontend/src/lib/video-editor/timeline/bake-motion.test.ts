import { describe, expect, it } from 'vitest';
import type { MotionModifier, TimelineItem } from '$lib/video-editor/project/types';
import { resolveAnimatedItemAt } from './animated-properties';
import { bakeMotionModifiersToKeyframes } from './bake-motion';

const context = { fps: 30, frameWidth: 1920, frameHeight: 1080 };

function modifier(overrides: Partial<MotionModifier> = {}): MotionModifier {
	return {
		version: 2,
		id: 'motion',
		type: 'sway',
		enabled: true,
		amplitude: 1,
		frequency: 0.5,
		phaseFrames: 0,
		seed: 7,
		...overrides
	};
}

function item(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip',
		trackId: 'visual',
		from: 20,
		durationInFrames: 61,
		label: 'Clip',
		type: 'video',
		transform: { x: 100, y: 200, width: 400, height: 300, rotation: 10, opacity: 0.8 },
		motionModifiers: [modifier()],
		...overrides
	};
}

describe('bakeMotionModifiersToKeyframes', () => {
	it('uses six samples per smooth cycle and includes both visible boundaries', () => {
		const baked = bakeMotionModifiersToKeyframes(item(), context);
		expect(baked.properties).toEqual(['rotation']);
		expect(baked.keyframes.map((keyframe) => keyframe.frame)).toEqual([0, 10, 20, 30, 40, 50, 60]);
	});

	it('samples shake at its seeded noise rate', () => {
		const baked = bakeMotionModifiersToKeyframes(
			item({ motionModifiers: [modifier({ type: 'micro-shake', frequency: 8 })] }),
			context
		);
		expect(
			baked.keyframes.filter((keyframe) => keyframe.property === 'x').map((key) => key.frame)
		).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60]);
	});

	it('samples both axes for a coupled position lane and matches live output', () => {
		const clip = item({
			motionModifiers: [
				modifier({
					type: 'float-drift',
					frequency: 1,
					channelGains: { x: 1, y: 0, rotation: 0 }
				})
			],
			vectorKeyframes: {
				position: [
					{ id: 'start', frame: 0, value: { x: 100, y: 200 }, easing: 'linear' },
					{ id: 'end', frame: 60, value: { x: 300, y: 500 }, easing: 'linear' }
				]
			}
		});
		const baked = bakeMotionModifiersToKeyframes(clip, context);
		expect(baked.properties).toEqual(['x', 'y']);
		for (const frame of [0, 5, 30, 60]) {
			const live = resolveAnimatedItemAt(clip, clip.from + frame, context);
			expect(
				baked.keyframes.find((keyframe) => keyframe.property === 'x' && keyframe.frame === frame)
					?.value
			).toBeCloseTo(live.transform?.x ?? 0, 8);
			expect(
				baked.keyframes.find((keyframe) => keyframe.property === 'y' && keyframe.frame === frame)
					?.value
			).toBeCloseTo(live.transform?.y ?? 0, 8);
		}
	});

	it('keeps a one-frame clip visually stable when the live source is removed', () => {
		const baked = bakeMotionModifiersToKeyframes(item({ durationInFrames: 1 }), context);
		expect(baked.keyframes).toHaveLength(1);
		expect(baked.keyframes[0]?.frame).toBe(0);
	});

	it('is deterministic for the same seeded input', () => {
		const clip = item({
			motionModifiers: [modifier({ type: 'micro-shake', frequency: 8, seed: 91 })]
		});
		expect(bakeMotionModifiersToKeyframes(clip, context)).toEqual(
			bakeMotionModifiersToKeyframes(clip, context)
		);
	});
});
