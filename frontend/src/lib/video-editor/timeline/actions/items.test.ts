import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { addTextItem, linkItems, setCurrentFrame, unlinkItems } from './items';

function clip(overrides: Partial<TimelineItem>): TimelineItem {
	return {
		id: 'clip',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 30,
		label: 'Clip',
		type: 'video',
		mediaId: 'media',
		sourceStart: 0,
		sourceEnd: 30,
		...overrides
	};
}

describe('addTextItem', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
	});

	it('adds three seconds of text to the top visual track at the playhead and undoes it', () => {
		setCurrentFrame(75);

		const id = addTextItem('Add text');

		expect(timelineStore.itemById.get(id)).toMatchObject({
			id,
			trackId: 'track-video-overlay',
			from: 75,
			durationInFrames: 90,
			label: 'Add text',
			text: 'Add text',
			type: 'text'
		});
		expect(commandHistory.getLastCommandType()).toBe('ADD_TEXT_ITEM');

		commandHistory.undo();
		expect(timelineStore.itemById.has(id)).toBe(false);
	});
});

describe('linked item actions', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
	});

	it('links the full existing groups behind a multi-item selection', () => {
		const video = clip({ id: 'video', linkedGroupId: 'old-group' });
		const audio = clip({
			id: 'audio',
			trackId: 'track-audio',
			type: 'audio',
			linkedGroupId: 'old-group'
		});
		const secondAudio = clip({
			id: 'second-audio',
			trackId: 'track-audio',
			type: 'audio'
		});
		timelineStore._setItems([video, audio, secondAudio]);

		expect(linkItems(['video', 'second-audio'])).toBe(true);
		const group = timelineStore.itemById.get('video')?.linkedGroupId;
		expect(group).toBeTruthy();
		expect(timelineStore.items.map((item) => item.linkedGroupId)).toEqual([group, group, group]);
		expect(commandHistory.getLastCommandType()).toBe('LINK_ITEMS');

		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.linkedGroupId)).toEqual([
			'old-group',
			'old-group',
			undefined
		]);
	});

	it('does not create a link for one selected clip', () => {
		timelineStore._setItems([clip({ id: 'video' })]);

		expect(linkItems(['video'])).toBe(false);
		expect(commandHistory.canUndo).toBe(false);
	});

	it('unlinks every member of a selected clip group as one undo step', () => {
		timelineStore._setItems([
			clip({ id: 'video', linkedGroupId: 'group' }),
			clip({
				id: 'audio',
				trackId: 'track-audio',
				type: 'audio',
				linkedGroupId: 'group'
			})
		]);

		expect(unlinkItems(['video'])).toBe(true);
		expect(timelineStore.items.map((item) => item.linkedGroupId)).toEqual([undefined, undefined]);
		expect(commandHistory.getLastCommandType()).toBe('UNLINK_ITEMS');

		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.linkedGroupId)).toEqual(['group', 'group']);
	});
});
