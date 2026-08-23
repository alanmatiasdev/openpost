// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { timelineStore } from '../../timeline/stores/timeline-store.svelte';
import type { MediaMetadata } from '../types';
import { insertSceneAtPlayhead } from './scene-insert';
import type { MediaScene } from './types';

vi.mock('../../timeline/commands/command-store.svelte', () => ({
	execute: (_type: string, action: () => unknown) => action()
}));

const media: MediaMetadata = {
	id: 'media-1',
	storageType: 'workspace',
	fileName: 'source.mp4',
	fileSize: 100,
	mimeType: 'video/mp4',
	duration: 20,
	width: 1920,
	height: 1080,
	fps: 24,
	codec: 'h264',
	bitrate: 1_000_000,
	tags: ['video']
};

const scene: MediaScene = {
	id: 'media-1:2',
	mediaId: 'media-1',
	index: 2,
	startSec: 3.25,
	endSec: 5.75,
	timeSec: 3.4,
	text: 'A person enters the room'
};

describe('insertSceneAtPlayhead', () => {
	beforeEach(() => {
		timelineStore.setAll({
			fps: 30,
			currentFrame: 90,
			tracks: [
				{
					id: 'video-main',
					name: 'Video',
					kind: 'video',
					height: 64,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 1
				}
			],
			items: []
		});
	});

	it('maps exact source seconds to source frames and timeline duration', () => {
		const id = insertSceneAtPlayhead(scene, media);
		const item = timelineStore.itemById.get(id);
		expect(item).toMatchObject({
			trackId: 'video-main',
			from: 90,
			durationInFrames: 75,
			sourceStart: 78,
			sourceEnd: 138,
			sourceDuration: 480,
			sourceFps: 24
		});
	});

	it('keeps the full source duration so later trims can reveal adjacent footage', () => {
		const id = insertSceneAtPlayhead(scene, media);
		const item = timelineStore.itemById.get(id)!;
		expect(item.sourceDuration).toBe(480);
		expect(item.sourceEnd).toBeLessThan(item.sourceDuration!);
	});

	it('creates an overlay track when every unlocked visual track collides', () => {
		timelineStore._addItem({
			id: 'existing',
			trackId: 'video-main',
			from: 80,
			durationInFrames: 100,
			label: 'Existing',
			type: 'video',
			mediaId: media.id
		});
		const id = insertSceneAtPlayhead(scene, media);
		const item = timelineStore.itemById.get(id)!;
		expect(item.trackId).not.toBe('video-main');
		expect(timelineStore.tracks.find((track) => track.id === item.trackId)).toMatchObject({
			kind: 'video',
			order: -1
		});
	});
});
