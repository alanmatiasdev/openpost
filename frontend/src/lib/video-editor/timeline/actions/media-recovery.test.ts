import { beforeEach, describe, expect, it } from 'vitest';
import type { MediaMetadata } from '../../media/types';
import type { TimelineItem, TimelineTrack } from '../../project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { relinkOrphanedClip, relinkOrphanedClips } from './media-recovery';

const videoTrack: TimelineTrack = {
	id: 'video-track',
	name: 'Video',
	kind: 'video',
	height: 80,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};
const audioTrack: TimelineTrack = {
	id: 'audio-track',
	name: 'Audio',
	kind: 'audio',
	height: 80,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 1
};
const tracks = [videoTrack, audioTrack];

function clip(id: string, type: 'video' | 'audio'): TimelineItem {
	return {
		id,
		trackId: `${type}-track`,
		from: 0,
		durationInFrames: 120,
		label: 'missing.mov',
		type,
		mediaId: 'missing',
		sourceStart: 10,
		sourceEnd: 200,
		sourceDuration: 300,
		sourceFps: 30,
		linkedGroupId: 'pair'
	};
}

function media(kind: 'video' | 'audio'): MediaMetadata {
	return {
		id: `replacement-${kind}`,
		storageType: 'workspace',
		fileName: `replacement.${kind === 'video' ? 'mp4' : 'wav'}`,
		fileSize: 1_000,
		mimeType: kind === 'video' ? 'video/mp4' : 'audio/wav',
		duration: 4,
		width: kind === 'video' ? 1280 : 0,
		height: kind === 'video' ? 720 : 0,
		fps: kind === 'video' ? 24 : 0,
		codec: kind === 'video' ? 'avc' : '',
		audioCodec: kind === 'video' ? 'aac' : kind === 'audio' ? 'pcm' : undefined,
		bitrate: 1_000_000,
		tags: [kind]
	};
}

beforeEach(() => {
	timelineStore.setAll({
		tracks,
		items: [clip('video', 'video'), clip('audio', 'audio')],
		fps: 30
	});
	commandHistory.clearHistory();
});

describe('orphaned clip relinking', () => {
	it('relinks every compatible clip sharing the missing media id in one undo step', () => {
		const result = relinkOrphanedClip('video', media('video'));

		expect(result).toEqual({ ok: true, itemIds: ['video', 'audio'] });
		expect(timelineStore.itemById.get('video')).toMatchObject({
			mediaId: 'replacement-video',
			label: 'replacement.mp4',
			sourceFps: 24,
			sourceDuration: 96,
			sourceEnd: 96,
			sourceWidth: 1280,
			sourceHeight: 720
		});
		expect(timelineStore.itemById.get('audio')).toMatchObject({
			mediaId: 'replacement-video',
			label: 'replacement.mp4',
			sourceFps: 24,
			sourceDuration: 96,
			sourceEnd: 96
		});

		commandHistory.undo();
		expect(timelineStore.itemById.get('video')?.mediaId).toBe('missing');
		expect(timelineStore.itemById.get('audio')?.mediaId).toBe('missing');
	});

	it('rejects the wrong media kind and any target on a locked track', () => {
		expect(relinkOrphanedClip('video', media('audio'))).toEqual({
			ok: false,
			reason: 'incompatible'
		});
		timelineStore._setTracks([{ ...videoTrack, locked: true }, audioTrack]);
		expect(relinkOrphanedClip('video', media('video'))).toEqual({
			ok: false,
			reason: 'locked'
		});
	});

	it('applies a batch as one atomic undo entry', () => {
		const imageTrack: TimelineTrack = { ...videoTrack, id: 'image-track', name: 'Images' };
		const image: TimelineItem = {
			...clip('image', 'video'),
			trackId: imageTrack.id,
			mediaId: 'missing-image',
			label: 'missing-image.mp4'
		};
		timelineStore.setAll({
			tracks: [...tracks, imageTrack],
			items: [...timelineStore.items, image]
		});

		const result = relinkOrphanedClips([
			{ itemId: 'video', replacement: media('video') },
			{ itemId: 'image', replacement: { ...media('video'), id: 'second-video' } }
		]);

		expect(result).toEqual({ ok: true, itemIds: ['video', 'audio', 'image'] });
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('video')?.mediaId).toBe('missing');
		expect(timelineStore.itemById.get('image')?.mediaId).toBe('missing-image');
	});
});
