import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import { planRollingTrimGesture, planSlipGesture, planTrimGesture } from './edit-gesture';

function mediaItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip',
		trackId: 'video',
		from: 100,
		durationInFrames: 60,
		label: 'Clip',
		type: 'video',
		sourceStart: 30,
		sourceEnd: 90,
		sourceDuration: 120,
		sourceFps: 30,
		speed: 1,
		...overrides
	};
}

describe('timeline edit gestures', () => {
	it('trims the start while keeping timeline and source windows aligned', () => {
		expect(planTrimGesture(mediaItem(), 'start', 10, [], 30, [], 2)).toEqual({
			patch: { from: 110, durationInFrames: 50, sourceStart: 40 },
			snapTarget: null
		});
	});

	it('extends the start only as far as available source material', () => {
		expect(planTrimGesture(mediaItem(), 'start', -50, [], 30, [], 2).patch).toEqual({
			from: 70,
			durationInFrames: 90,
			sourceStart: 0
		});
	});

	it('clamps end extension to the source and the next clip', () => {
		const next = mediaItem({ id: 'next', from: 175, sourceStart: 0, sourceEnd: 20 });
		expect(planTrimGesture(mediaItem(), 'end', 100, [next], 30, [], 2).patch).toEqual({
			durationInFrames: 75,
			sourceEnd: 105
		});
	});

	it('snaps the edited edge before applying source and adjacency clamps', () => {
		const result = planTrimGesture(
			mediaItem(),
			'start',
			-8,
			[],
			30,
			[{ frame: 90, type: 'item-end', itemId: 'left' }],
			4
		);
		expect(result.patch).toEqual({ from: 90, durationInFrames: 70, sourceStart: 20 });
		expect(result.snapTarget).toEqual({ frame: 90, type: 'item-end', itemId: 'left' });
	});

	it('rolls one cut while preserving both clip windows and the total duration', () => {
		const left = mediaItem({
			id: 'left',
			from: 0,
			durationInFrames: 50,
			sourceStart: 0,
			sourceEnd: 50,
			sourceDuration: 100
		});
		const right = mediaItem({
			id: 'right',
			from: 50,
			durationInFrames: 50,
			sourceStart: 50,
			sourceEnd: 100,
			sourceDuration: 150
		});
		expect(planRollingTrimGesture(left, right, 10, [], 30, [], 2)).toEqual({
			leftPatch: { durationInFrames: 60, sourceEnd: 60 },
			rightPatch: { from: 60, durationInFrames: 40, sourceStart: 60 },
			snapTarget: null
		});
		expect(planRollingTrimGesture(left, right, -10, [], 30, [], 2)).toEqual({
			leftPatch: { durationInFrames: 40, sourceEnd: 40 },
			rightPatch: { from: 40, durationInFrames: 60, sourceStart: 40 },
			snapTarget: null
		});
	});

	it('refuses a rolling trim when the clips do not share one cut', () => {
		const left = mediaItem({ id: 'left', from: 0, durationInFrames: 40 });
		const right = mediaItem({ id: 'right', from: 50 });
		expect(planRollingTrimGesture(left, right, 5, [], 30, [], 2)).toBeNull();
	});

	it('slips source content in source-native frames without moving the clip', () => {
		const item = mediaItem({ sourceDuration: 240, speed: 2 });
		expect(planSlipGesture(item, -20, 30)).toEqual({ sourceStart: 70, sourceEnd: 130 });
		expect(planSlipGesture(item, 100, 30)).toEqual({ sourceStart: 0, sourceEnd: 60 });
	});

	it('requires an explicit source end before slipping', () => {
		expect(planSlipGesture(mediaItem({ sourceEnd: undefined }), 10, 30)).toBeNull();
	});

	it('does not offer slip for generated timeline items', () => {
		expect(planSlipGesture({ ...mediaItem(), type: 'text' }, 10, 30)).toBeNull();
	});
});
