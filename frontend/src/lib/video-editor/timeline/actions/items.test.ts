import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { addTextItem, setCurrentFrame } from './items';

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
