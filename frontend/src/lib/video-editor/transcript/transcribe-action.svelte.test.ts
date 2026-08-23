import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { addGeneratedSubtitleItem, transcriptionSourceWindow } from './transcribe-action';

const track: TimelineTrack = {
	id: 'video',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const source: TimelineItem = {
	id: 'source',
	trackId: track.id,
	from: 90,
	durationInFrames: 150,
	label: 'Interview',
	type: 'video',
	mediaId: 'media',
	sourceStart: 300,
	sourceEnd: 600,
	sourceFps: 30,
	speed: 2
};

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [source], fps: 30 });
});

describe('transcription timeline mapping', () => {
	it('decodes only the selected source window', () => {
		expect(transcriptionSourceWindow(source)).toEqual({
			sourceStartSeconds: 10,
			sourceEndSeconds: 20
		});
	});

	it('places captions at the clip start and scales timings by playback speed', () => {
		const subtitleId = addGeneratedSubtitleItem(source.id, [
			{ text: 'Hello', startSeconds: 1, endSeconds: 2 }
		]);
		const subtitle = timelineStore.itemById.get(subtitleId);
		expect(subtitle).toMatchObject({ from: source.from, type: 'subtitle' });
		expect(subtitle?.cues?.[0]).toMatchObject({
			text: 'Hello',
			startFrame: 15,
			endFrame: 30
		});
		expect(commandHistory.undoStack).toHaveLength(1);
	});
});
