import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack, TimelineTransition } from '../project/types';
import { createTrackPushGesturePlan, resolveTrackPush, trackPushGapBefore } from './track-push';

function track(id: string, overrides: Partial<TimelineTrack> = {}): TimelineTrack {
	return {
		id,
		name: id,
		kind: 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0,
		...overrides
	};
}

function item(id: string, trackId: string, from: number, durationInFrames: number): TimelineItem {
	return { id, trackId, from, durationInFrames, label: id, type: 'video' };
}

function transition(id: string, fromItemId: string, toItemId: string): TimelineTransition {
	return {
		id,
		type: 'crossfade',
		durationInFrames: 10,
		fromItemId,
		toItemId
	};
}

describe('track push', () => {
	it('moves every clip at or after the cut and clamps left by the tightest track gap', () => {
		const items = [
			item('v-static', 'video', 0, 60),
			item('v-anchor', 'video', 100, 20),
			item('v-later', 'video', 150, 20),
			item('a-static', 'audio', 0, 85),
			item('a-shifted', 'audio', 110, 30),
			item('hidden-shifted', 'hidden', 130, 10)
		];
		const plan = createTrackPushGesturePlan({
			anchorId: 'v-anchor',
			items,
			tracks: [track('video'), track('audio'), track('hidden', { visible: false })],
			transitions: []
		});

		expect(plan.maxLeftFrames).toBe(25);
		expect(plan.shiftedItems.map((candidate) => candidate.id)).toEqual([
			'v-anchor',
			'v-later',
			'a-shifted',
			'hidden-shifted'
		]);
		expect(resolveTrackPush(plan, -40).moves).toEqual([
			{ id: 'v-anchor', from: 75 },
			{ id: 'v-later', from: 125 },
			{ id: 'a-shifted', from: 85 },
			{ id: 'hidden-shifted', from: 105 }
		]);
	});

	it('snaps the anchor only against static targets and keeps the clamp authoritative', () => {
		const plan = createTrackPushGesturePlan({
			anchorId: 'anchor',
			items: [item('static', 'video', 0, 80), item('anchor', 'video', 100, 20)],
			tracks: [track('video')],
			transitions: []
		});

		expect(
			resolveTrackPush(plan, 7, [{ frame: 110, type: 'marker', markerId: 'm' }], 5)
		).toMatchObject({ delta: 10, snapTarget: { frame: 110, type: 'marker' } });
		expect(resolveTrackPush(plan, -18, [{ frame: 70, type: 'playhead' }], 20)).toMatchObject({
			delta: -20,
			snapTarget: null
		});
	});

	it('blocks the whole edit when an affected track or its group is locked', () => {
		const items = [item('anchor', 'video', 100, 20), item('later', 'audio', 120, 20)];
		const tracks = [
			track('video'),
			track('group', { isGroup: true, kind: undefined }),
			track('audio', { parentTrackId: 'group' })
		];
		tracks[1].locked = true;
		const plan = createTrackPushGesturePlan({
			anchorId: 'anchor',
			items,
			tracks,
			transitions: []
		});

		expect(plan.blockedBy).toBe('downstream-locked');
		expect(plan.lockedItemIds).toEqual(['later']);
		expect(resolveTrackPush(plan, 20).moves).toEqual([]);
	});

	it('keeps transitions inside either side and breaks only pairs that straddle the cut', () => {
		const items = [
			item('left-a', 'video', 0, 40),
			item('left-b', 'video', 40, 40),
			item('right-a', 'video', 100, 20),
			item('right-b', 'video', 120, 20)
		];
		const plan = createTrackPushGesturePlan({
			anchorId: 'right-a',
			items,
			tracks: [track('video')],
			transitions: [
				transition('left', 'left-a', 'left-b'),
				transition('straddle', 'left-b', 'right-a'),
				transition('right', 'right-a', 'right-b')
			]
		});

		expect(plan.breakingTransitionIds).toEqual(['straddle']);
	});

	it('requires real empty space before the anchor on its own track', () => {
		const anchor = item('anchor', 'video', 100, 20);
		expect(trackPushGapBefore(anchor, [item('before', 'video', 0, 80), anchor])).toBe(20);
		expect(trackPushGapBefore(anchor, [item('overlap', 'video', 50, 70), anchor])).toBe(0);
	});
});
