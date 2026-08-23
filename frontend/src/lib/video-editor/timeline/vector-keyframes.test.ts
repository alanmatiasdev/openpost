import { describe, expect, it } from 'vitest';
import type { TimelineItem, VectorKeyframe } from '$lib/video-editor/project/types';
import {
	defaultSpatialTangents,
	interpolatePosition,
	interpolatePositionSegment,
	promotePositionKeyframes,
	scaleItemVectorKeyframes,
	withSpatialTangent
} from './vector-keyframes';

function item(patch: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'item',
		trackId: 'track',
		from: 0,
		durationInFrames: 101,
		label: 'Item',
		type: 'image',
		transform: { x: 10, y: 20 },
		...patch
	};
}

function keyframe(frame: number, x: number, y: number): VectorKeyframe {
	return { id: `key-${frame}`, frame, value: { x, y }, easing: 'linear' };
}

describe('position vector keyframes', () => {
	it('promotes the union of legacy X/Y frames and preserves interpolation', () => {
		const promoted = promotePositionKeyframes(
			item({
				keyframes: {
					x: { frames: [0, 100], values: [0, 100], easings: ['ease-in', 'linear'] },
					y: { frames: [0, 50, 100], values: [20, 40, 80] },
					opacity: { frames: [25], values: [0.5] }
				}
			})
		);

		expect(promoted?.position.map((entry) => entry.frame)).toEqual([0, 50, 100]);
		expect(promoted?.position[1]?.value.x).toBeCloseTo(25);
		expect(promoted?.position[1]?.value.y).toBe(40);
		expect(promoted?.position[1]?.easing).toBe('ease-in');
		expect(promoted?.keyframes).toEqual({ opacity: { frames: [25], values: [0.5] } });
	});

	it('uses temporal easing before spatial cubic interpolation', () => {
		const frames = [
			{
				...keyframe(0, 0, 0),
				easing: 'ease-in' as const,
				spatial: {
					inTangent: { x: -10, y: 0 },
					outTangent: { x: 0, y: 100 }
				}
			},
			{
				...keyframe(100, 100, 0),
				spatial: {
					inTangent: { x: 0, y: 100 },
					outTangent: { x: 10, y: 0 }
				}
			}
		];
		const midpoint = interpolatePosition(frames, 50);
		const spatialQuarter = interpolatePositionSegment(frames[0]!, frames[1]!, 0.25);
		expect(midpoint?.x).toBeCloseTo(spatialQuarter.x);
		expect(midpoint?.y).toBeCloseTo(spatialQuarter.y);
		expect(midpoint?.y).toBeGreaterThan(40);
	});

	it('creates smooth default handles and mirrors continuous edits', () => {
		const frames = [keyframe(0, 0, 0), keyframe(50, 60, 30), keyframe(100, 120, 0)];
		const spatial = defaultSpatialTangents(frames, 1);
		expect(spatial).toEqual({
			inTangent: { x: -20, y: 0 },
			outTangent: { x: 20, y: 0 },
			continuous: true
		});
		expect(withSpatialTangent(spatial!, 'in', { x: -30, y: 12 })).toEqual({
			inTangent: { x: -30, y: 12 },
			outTangent: { x: 30, y: -12 },
			continuous: true
		});
	});

	it('scales vector timing and resolves frame collisions deterministically', () => {
		const scaled = scaleItemVectorKeyframes(
			{ position: [keyframe(0, 0, 0), keyframe(1, 10, 10), keyframe(100, 100, 100)] },
			101,
			2
		);
		expect(scaled?.position?.map((entry) => entry.frame)).toEqual([0, 1]);
		expect(scaled?.position?.[0]?.id).toBe('key-1');
	});
});
