import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { editorKeyframes, keyframeIdentity } from './keyframe-editor';
import {
	buildDopesheetRetimePreview,
	buildKeyframePastePlan,
	shiftRangeSelection
} from './keyframe-dopesheet';

const item: TimelineItem = {
	id: 'clip',
	trackId: 'video',
	from: 0,
	durationInFrames: 60,
	label: 'Clip',
	type: 'video',
	keyframes: {
		opacity: {
			frames: [10, 20, 30],
			values: [0, 0.5, 1],
			ids: ['a', 'b', 'c']
		},
		rotation: { frames: [12], values: [90], ids: ['d'] }
	}
};
const keyframes = [...editorKeyframes(item, 'opacity'), ...editorKeyframes(item, 'rotation')];

describe('buildDopesheetRetimePreview', () => {
	it('constrains a multi-key move before unselected neighbors', () => {
		const preview = buildDopesheetRetimePreview({
			keyframes,
			selectionIds: new Set(['a', 'b']),
			lockedProperties: new Set(),
			requestedDeltaFrames: 20,
			totalFrames: 60,
			blockedRanges: []
		});
		expect(preview.appliedDeltaFrames).toBe(9);
		expect(Object.fromEntries(preview.frames)).toEqual({ a: 19, b: 29 });
	});

	it('uses one common transition-safe delta and skips locked lanes', () => {
		const preview = buildDopesheetRetimePreview({
			keyframes,
			selectionIds: new Set(['b', 'd']),
			lockedProperties: new Set(['rotation']),
			requestedDeltaFrames: 8,
			totalFrames: 60,
			blockedRanges: [{ start: 25, end: 29 }]
		});
		expect(preview.appliedDeltaFrames).toBe(4);
		expect(Object.fromEntries(preview.frames)).toEqual({ b: 24 });
	});
});

describe('shiftRangeSelection', () => {
	it('adds every key between the lane anchor and target', () => {
		expect(shiftRangeSelection(keyframes, new Set(['d']), 'opacity', 'a', 'c')).toEqual(
			new Set(['d', 'a', 'b', 'c'])
		);
	});

	it('falls back to adding the target when the anchor is stale', () => {
		const target = keyframeIdentity(keyframes[1]!);
		expect(shiftRangeSelection(keyframes, new Set(), 'opacity', 'missing', target)).toEqual(
			new Set([target])
		);
	});
});

describe('buildKeyframePastePlan', () => {
	it('anchors normalized frames, clamps clip bounds, and preserves easing', () => {
		const plan = buildKeyframePastePlan({
			clipboard: {
				sourceItemId: 'source',
				originFrame: 20,
				sourceRefs: [],
				keyframes: [
					{ property: 'opacity', frame: 0, value: 0.2, easing: 'hold' },
					{
						property: 'rotation',
						frame: 20,
						value: 180,
						easing: 'cubic-bezier',
						easingConfig: {
							type: 'cubic-bezier',
							bezier: { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 }
						}
					},
					{ property: 'fontSize', frame: 2, value: 32, easing: 'linear' }
				]
			},
			item,
			anchorFrame: 50,
			availableProperties: ['opacity', 'rotation'],
			blockedRanges: []
		});
		expect(plan).toMatchObject({
			inserts: [
				{ property: 'opacity', frame: 50, value: 0.2, easing: 'hold' },
				{ property: 'rotation', frame: 59, value: 180, easing: 'cubic-bezier' }
			],
			skippedUnsupported: 1,
			skippedBlocked: 0
		});
	});

	it('skips transition-owned paste frames', () => {
		const plan = buildKeyframePastePlan({
			clipboard: {
				sourceItemId: 'source',
				originFrame: 0,
				sourceRefs: [],
				keyframes: [
					{ property: 'opacity', frame: 0, value: 0, easing: 'linear' },
					{ property: 'opacity', frame: 5, value: 1, easing: 'linear' }
				]
			},
			item,
			anchorFrame: 50,
			availableProperties: ['opacity'],
			blockedRanges: [{ start: 54, end: 60 }]
		});
		expect(plan.inserts).toEqual([{ property: 'opacity', frame: 50, value: 0, easing: 'linear' }]);
		expect(plan.skippedBlocked).toBe(1);
	});

	it('preserves vector grouping and spatial handles in the paste plan', () => {
		const spatial = {
			inTangent: { x: -20, y: 10 },
			outTangent: { x: 30, y: 15 },
			continuous: false
		};
		const plan = buildKeyframePastePlan({
			clipboard: {
				sourceItemId: 'source',
				originFrame: 10,
				sourceRefs: [],
				keyframes: [
					{
						property: 'x',
						frame: 0,
						value: 40,
						easing: 'ease-out',
						vectorGroupId: 'position-a',
						spatial
					},
					{
						property: 'y',
						frame: 0,
						value: -15,
						easing: 'ease-out',
						vectorGroupId: 'position-a',
						spatial
					}
				]
			},
			item,
			anchorFrame: 25,
			availableProperties: ['x', 'y'],
			blockedRanges: []
		});
		expect(plan.inserts).toMatchObject([
			{
				property: 'x',
				frame: 25,
				vectorGroupId: 'position-a',
				spatial: { outTangent: { x: 30, y: 15 } }
			},
			{
				property: 'y',
				frame: 25,
				vectorGroupId: 'position-a',
				spatial: { outTangent: { x: 30, y: 15 } }
			}
		]);
	});
});
