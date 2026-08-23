import { describe, expect, it } from 'vitest';
import type { TimelineTrack } from '../project/types';
import {
	MAX_TRACK_HEIGHT,
	MIN_TRACK_HEIGHT,
	clampTrackHeight,
	defaultTrackHeight,
	resetTrackHeightsInList,
	resizeAllTracksInList,
	resizeTrackInList
} from './track-resize';

function track(id: string, kind: 'video' | 'audio', height: number): TimelineTrack {
	return {
		id,
		name: id,
		kind,
		height,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0
	};
}

describe('track height resizing', () => {
	it('rounds and clamps to the supported bounds', () => {
		expect(clampTrackHeight(96.6)).toBe(97);
		expect(clampTrackHeight(MIN_TRACK_HEIGHT - 1)).toBe(MIN_TRACK_HEIGHT);
		expect(clampTrackHeight(MAX_TRACK_HEIGHT + 1)).toBe(MAX_TRACK_HEIGHT);
	});

	it('updates one track while preserving untouched object identities', () => {
		const tracks = [track('video', 'video', 96), track('audio', 'audio', 72)];
		const resized = resizeTrackInList(tracks, 'audio', 110);
		expect(resized).not.toBe(tracks);
		expect(resized[0]).toBe(tracks[0]);
		expect(resized[1]).toMatchObject({ id: 'audio', height: 110 });
		expect(resizeTrackInList(resized, 'missing', 80)).toBe(resized);
		expect(resizeTrackInList(resized, 'audio', 110)).toBe(resized);
	});

	it('resizes all tracks to one shared height', () => {
		const tracks = [track('video', 'video', 96), track('audio', 'audio', 72)];
		const resized = resizeAllTracksInList(tracks, 88);
		expect(resized.map((candidate) => candidate.height)).toEqual([88, 88]);
		expect(resizeAllTracksInList(resized, 88)).toBe(resized);
	});

	it('resets one or all tracks to kind-specific defaults', () => {
		const tracks = [track('video', 'video', 120), track('audio', 'audio', 120)];
		expect(defaultTrackHeight(tracks[0]!)).toBe(96);
		expect(defaultTrackHeight(tracks[1]!)).toBe(72);
		expect(
			resetTrackHeightsInList(tracks, 'video', false).map((candidate) => candidate.height)
		).toEqual([96, 120]);
		expect(
			resetTrackHeightsInList(tracks, 'video', true).map((candidate) => candidate.height)
		).toEqual([96, 72]);
	});
});
