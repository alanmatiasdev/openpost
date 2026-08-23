import { beforeEach, describe, expect, it } from 'vitest';
import type { MediaMetadata } from '../media/types';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { insertGeneratedAudioOnNewTrack } from './insert-generated-audio';

const media: MediaMetadata = {
	id: 'generated-media',
	storageType: 'workspace',
	fileName: 'voice.wav',
	fileSize: 1024,
	mimeType: 'audio/wav',
	duration: 2,
	width: 0,
	height: 0,
	fps: 0,
	codec: '',
	bitrate: 4096,
	tags: ['audio', 'ai-generated']
};

function track(id: string, kind: 'video' | 'audio', order: number): TimelineTrack {
	return {
		id,
		name: kind === 'audio' ? 'Audio 1' : 'Video 1',
		kind,
		height: 72,
		locked: false,
		syncLock: true,
		visible: true,
		muted: false,
		solo: false,
		volume: 1,
		order
	};
}

describe('insertGeneratedAudioOnNewTrack', () => {
	beforeEach(() => {
		commandHistory.clearHistory();
		timelineStore.clear();
		timelineStore.setAll({
			fps: 30,
			tracks: [track('video-track', 'video', 0), track('audio-track', 'audio', 1)]
		});
	});

	it('keeps existing audio intact and inserts at the captured playhead', () => {
		const existing: TimelineItem = {
			id: 'existing',
			trackId: 'audio-track',
			from: 60,
			durationInFrames: 90,
			label: 'existing.wav',
			type: 'audio',
			mediaId: 'existing-media'
		};
		timelineStore._setItems([existing]);

		const id = insertGeneratedAudioOnNewTrack(media, 87);
		const inserted = timelineStore.itemById.get(id);
		const newTrack = timelineStore.tracks.find((candidate) => candidate.id === inserted?.trackId);

		expect(inserted).toMatchObject({
			from: 87,
			durationInFrames: 60,
			mediaId: media.id,
			sourceEnd: 60,
			sourceDuration: 60,
			sourceFps: 30
		});
		expect(newTrack).toMatchObject({ kind: 'audio', name: 'Audio 2', order: 2 });
		expect(timelineStore.itemById.get(existing.id)).toEqual(existing);
	});

	it('undoes the generated clip and its track together', () => {
		insertGeneratedAudioOnNewTrack(media, 42);

		commandHistory.undo();

		expect(timelineStore.items).toEqual([]);
		expect(timelineStore.tracks.map((candidate) => candidate.id)).toEqual([
			'video-track',
			'audio-track'
		]);
	});
});
