import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../../project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { consolidateCaptionItems } from './captions';

const track: TimelineTrack = {
	id: 'captions',
	name: 'Captions',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const items: TimelineItem[] = [
	{
		id: 'video',
		trackId: 'video-track',
		from: 50,
		durationInFrames: 300,
		label: 'Source',
		type: 'video',
		linkedGroupId: 'av-pair'
	},
	{
		id: 'caption-early',
		trackId: track.id,
		from: 100,
		durationInFrames: 120,
		label: 'Hello',
		type: 'text',
		text: 'Hello',
		fontFamily: 'Roboto',
		fontWeight: 600,
		color: '#ffffff',
		captionSource: {
			type: 'subtitle-import',
			clipId: 'video',
			mediaId: 'media',
			fileName: 'source.srt',
			format: 'srt'
		}
	},
	{
		id: 'caption-late',
		trackId: track.id,
		from: 160,
		durationInFrames: 30,
		label: 'World',
		type: 'text',
		text: 'World',
		captionSource: {
			type: 'subtitle-import',
			clipId: 'video',
			mediaId: 'media',
			fileName: 'source.srt',
			format: 'srt'
		}
	},
	{
		id: 'title',
		trackId: track.id,
		from: 0,
		durationInFrames: 30,
		label: 'Manual title',
		type: 'text',
		text: 'Manual title'
	}
];

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore.setAll({
		tracks: [track, { ...track, id: 'video-track', name: 'Video', order: 1 }],
		items,
		fps: 30,
		currentFrame: 0
	});
});

describe('consolidateCaptionItems', () => {
	it("replaces one clip's caption text items with a styled subtitle item and undoes atomically", () => {
		const result = consolidateCaptionItems({ clipId: 'video' });

		expect(result.cuesConsolidated).toBe(2);
		expect(result.itemIds).toHaveLength(1);
		const subtitle = timelineStore.itemById.get(result.itemIds[0]!);
		expect(subtitle).toMatchObject({
			type: 'subtitle',
			trackId: 'captions',
			from: 100,
			durationInFrames: 120,
			linkedGroupId: 'av-pair',
			fontFamily: 'Roboto',
			fontWeight: 600,
			color: '#ffffff',
			captionSource: { type: 'subtitle-import', clipId: 'video' },
			cues: [
				{ id: 'caption-early', startFrame: 100, endFrame: 220, text: 'Hello' },
				{ id: 'caption-late', startFrame: 160, endFrame: 190, text: 'World' }
			]
		});
		expect(timelineStore.itemById.has('caption-early')).toBe(false);
		expect(timelineStore.itemById.has('caption-late')).toBe(false);
		expect(timelineStore.itemById.has('title')).toBe(true);
		expect(commandHistory.undoStack).toHaveLength(1);

		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.id)).toEqual(items.map((item) => item.id));
	});
});
