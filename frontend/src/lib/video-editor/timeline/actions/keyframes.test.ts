import { beforeEach, describe, expect, it } from 'vitest';
import type { KeyframeProperty, TimelineItem } from '$lib/video-editor/project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { activeValueAt, interpolateAt, removeKeyframe, setKeyframe } from './keyframes';

function getItem(id: string): TimelineItem {
	const item = timelineStore.itemById.get(id);
	if (!item) throw new Error(`missing item ${id}`);
	return item;
}

function trackOf(
	item: TimelineItem,
	property: KeyframeProperty
): { frames: number[]; values: number[] } {
	const track = item.keyframes?.[property];
	if (!track) throw new Error(`no ${property} track`);
	return track;
}

describe('setKeyframe', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		timelineStore._setItems([
			{
				id: 'a',
				trackId: 't',
				from: 100,
				durationInFrames: 60,
				label: '',
				type: 'video',
				opacity: 1,
				volume: 1
			}
		]);
	});

	it('inserts keyframes keeping frames ascending', () => {
		setKeyframe('a', 'opacity', 40, 0.5);
		setKeyframe('a', 'opacity', 10, 0);
		setKeyframe('a', 'opacity', 25, 0.25);
		const item = getItem('a');
		expect(trackOf(item, 'opacity')).toEqual({
			frames: [10, 25, 40],
			values: [0, 0.25, 0.5]
		});
		expect(commandHistory.undoStack.length).toBe(3);
	});

	it('replaces an existing keyframe at the same frame', () => {
		setKeyframe('a', 'volume', 20, 0.8);
		setKeyframe('a', 'volume', 20, 0.2);
		const track = trackOf(getItem('a'), 'volume');
		expect(track.frames).toEqual([20]);
		expect(track.values).toEqual([0.2]);
		expect(commandHistory.undoStack.length).toBe(2);
	});

	it('skips the history step when nothing changes', () => {
		setKeyframe('a', 'opacity', 15, 0.5);
		expect(commandHistory.undoStack.length).toBe(1);
		setKeyframe('a', 'opacity', 15, 0.5);
		expect(commandHistory.undoStack.length).toBe(1);
	});

	it('undoes back to the previous keyframe state', () => {
		setKeyframe('a', 'opacity', 10, 0);
		commandHistory.undo();
		const item = getItem('a');
		expect(item.keyframes?.opacity).toBeUndefined();
	});

	it('returns false and records nothing for a missing item', () => {
		expect(setKeyframe('missing', 'opacity', 0, 1)).toBe(false);
		expect(commandHistory.undoStack.length).toBe(0);
	});
});

describe('removeKeyframe', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		timelineStore._setItems([
			{
				id: 'a',
				trackId: 't',
				from: 0,
				durationInFrames: 60,
				label: '',
				type: 'video'
			}
		]);
	});

	it('removes only the keyed frame and keeps the rest sorted', () => {
		setKeyframe('a', 'opacity', 10, 0);
		setKeyframe('a', 'opacity', 20, 0.5);
		setKeyframe('a', 'opacity', 30, 1);
		expect(removeKeyframe('a', 'opacity', 20)).toBe(true);
		const track = trackOf(getItem('a'), 'opacity');
		expect(track.frames).toEqual([10, 30]);
		expect(track.values).toEqual([0, 1]);
	});

	it('drops the property once its last keyframe is removed', () => {
		setKeyframe('a', 'opacity', 10, 0);
		expect(removeKeyframe('a', 'opacity', 10)).toBe(true);
		const item = getItem('a');
		expect(item.keyframes?.opacity).toBeUndefined();
	});

	it('restores the removed keyframe on undo', () => {
		setKeyframe('a', 'volume', 12, 0.4);
		removeKeyframe('a', 'volume', 12);
		commandHistory.undo();
		expect(trackOf(getItem('a'), 'volume')).toEqual({ frames: [12], values: [0.4] });
	});

	it('returns false for absent tracks or frames', () => {
		expect(removeKeyframe('a', 'volume', 5)).toBe(false);
		setKeyframe('a', 'volume', 5, 1);
		expect(removeKeyframe('a', 'volume', 6)).toBe(false);
		expect(commandHistory.undoStack.length).toBe(1);
	});
});

describe('interpolateAt', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	});

	function itemWithTrack(frames: number[], values: number[]): TimelineItem {
		return {
			id: 'a',
			trackId: 't',
			from: 0,
			durationInFrames: 100,
			label: '',
			type: 'video',
			keyframes: { opacity: { frames, values } }
		};
	}

	it('returns null when the track is missing or empty', () => {
		const bare: TimelineItem = {
			id: 'b',
			trackId: 't',
			from: 0,
			durationInFrames: 10,
			label: '',
			type: 'video'
		};
		expect(interpolateAt(bare, 'opacity', 5)).toBeNull();
		expect(interpolateAt(itemWithTrack([], []), 'volume', 5)).toBeNull();
	});

	it('holds a single keyframe constant', () => {
		const item = itemWithTrack([30], [0.75]);
		expect(interpolateAt(item, 'opacity', 0)).toBe(0.75);
		expect(interpolateAt(item, 'opacity', 99)).toBe(0.75);
	});

	it('clamps constant before the first and after the last keyframe', () => {
		const item = itemWithTrack([10, 50], [0.2, 0.6]);
		expect(interpolateAt(item, 'opacity', 0)).toBe(0.2);
		expect(interpolateAt(item, 'opacity', 9)).toBe(0.2);
		expect(interpolateAt(item, 'opacity', 51)).toBe(0.6);
		expect(interpolateAt(item, 'opacity', 200)).toBe(0.6);
	});

	it('hits keyframes exactly and interpolates linearly between them', () => {
		const item = itemWithTrack([10, 50], [0.2, 0.6]);
		expect(interpolateAt(item, 'opacity', 10)).toBe(0.2);
		expect(interpolateAt(item, 'opacity', 50)).toBe(0.6);
		expect(interpolateAt(item, 'opacity', 30)).toBeCloseTo(0.4, 12);
		expect(interpolateAt(item, 'opacity', 20)).toBeCloseTo(0.3, 12);
	});
});

describe('activeValueAt', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	});

	it('converts absolute timeline frames to item-relative frames', () => {
		const item: TimelineItem = {
			id: 'a',
			trackId: 't',
			from: 100,
			durationInFrames: 60,
			label: '',
			type: 'video',
			keyframes: { volume: { frames: [0, 30], values: [0, 1] } }
		};
		expect(activeValueAt(item, 'volume', 100)).toBe(0);
		expect(activeValueAt(item, 'volume', 115)).toBeCloseTo(0.5, 12);
		expect(activeValueAt(item, 'volume', 130)).toBe(1);
		expect(activeValueAt(item, 'volume', 90)).toBe(0);
		expect(activeValueAt(item, 'volume', 160)).toBe(1);
	});
});
