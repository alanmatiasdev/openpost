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

	it('derives a bounded source window when an older item has no source end', () => {
		expect(
			transcriptionSourceWindow(
				{
					...source,
					durationInFrames: 60,
					sourceStart: 300,
					sourceEnd: undefined,
					sourceFps: 60,
					speed: 2
				},
				30
			)
		).toEqual({ sourceStartSeconds: 5, sourceEndSeconds: 9 });
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

	it('replaces every prior generated caption for the same clip in one undo step', () => {
		const firstSubtitleId = addGeneratedSubtitleItem(source.id, [
			{ text: 'Old words', startSeconds: 1, endSeconds: 2 }
		]);
		const firstSubtitle = timelineStore.itemById.get(firstSubtitleId)!;
		timelineStore._setItems([
			...timelineStore.items,
			{
				...firstSubtitle,
				id: 'old-duplicate',
				cues: firstSubtitle.cues?.map((cue) => ({
					...cue,
					words: cue.words?.map((word) => ({ ...word }))
				}))
			}
		]);
		commandHistory.clearHistory();

		const replacementId = addGeneratedSubtitleItem(source.id, [
			{ text: 'Correct words', startSeconds: 0.5, endSeconds: 1.5 }
		]);
		const generated = timelineStore.items.filter(
			(item) => item.captionSource?.type === 'transcript' && item.captionSource.clipId === source.id
		);

		expect(replacementId).toBe(firstSubtitleId);
		expect(generated).toHaveLength(1);
		expect(generated[0]?.cues?.[0]?.text).toBe('Correct words');
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(
			timelineStore.items.filter(
				(item) =>
					item.captionSource?.type === 'transcript' && item.captionSource.clipId === source.id
			)
		).toHaveLength(2);
	});

	it('rejects a late result after the source timing changed', () => {
		const snapshot = transcriptionSourceWindow(source);
		timelineStore._updateItems([{ id: source.id, patch: { sourceStart: 330 } }]);
		expect(() =>
			addGeneratedSubtitleItem(
				source.id,
				[{ text: 'Late', startSeconds: 0, endSeconds: 1 }],
				snapshot
			)
		).toThrow('changed while transcription was running');
		expect(commandHistory.undoStack).toHaveLength(0);
	});
});
