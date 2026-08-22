import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultTracks } from '../../project/defaults';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import {
	addTrack,
	removeTrack,
	toggleTrackLock,
	toggleTrackMute,
	toggleTrackSolo,
	toggleTrackSyncLock,
	toggleTrackVisibility
} from './tracks';

describe('timeline track actions', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
	});

	it('adds video above visual tracks and audio below audio tracks as one undoable edit', () => {
		const videoId = addTrack('video', 'Video 2');
		const audioId = addTrack('audio', 'Audio 2');
		const video = timelineStore.tracks.find((track) => track.id === videoId)!;
		const audio = timelineStore.tracks.find((track) => track.id === audioId)!;
		expect(video.order).toBeLessThan(
			Math.min(...createDefaultTracks().map((track) => track.order))
		);
		expect(audio.order).toBeGreaterThan(
			Math.max(...createDefaultTracks().map((track) => track.order))
		);
		expect(commandHistory.undoStack).toHaveLength(2);
		commandHistory.undo();
		expect(timelineStore.tracks.some((track) => track.id === audioId)).toBe(false);
	});

	it('removes a track and its clips without allowing the last track to be removed', () => {
		timelineStore._setItems([
			{
				id: 'clip',
				trackId: 'track-video-overlay',
				from: 0,
				durationInFrames: 30,
				label: 'Clip',
				type: 'video'
			}
		]);
		expect(removeTrack('track-video-overlay')).toBe(true);
		expect(timelineStore.itemById.has('clip')).toBe(false);
		expect(commandHistory.getLastCommandType()).toBe('REMOVE_TRACK');
		commandHistory.undo();
		expect(timelineStore.itemById.has('clip')).toBe(true);

		for (const track of timelineStore.tracks.slice(1)) removeTrack(track.id);
		expect(removeTrack(timelineStore.tracks[0]!.id)).toBe(false);
	});

	it('toggles lock, sync lock, visibility, mute, and solo independently', () => {
		const id = 'track-video-main';
		toggleTrackLock(id);
		toggleTrackVisibility(id);
		toggleTrackMute(id);
		toggleTrackSolo(id);
		toggleTrackSyncLock(id);
		expect(timelineStore.tracks.find((track) => track.id === id)).toMatchObject({
			locked: true,
			visible: false,
			muted: true,
			solo: true,
			syncLock: false
		});
		expect(commandHistory.undoStack).toHaveLength(5);
	});
});
