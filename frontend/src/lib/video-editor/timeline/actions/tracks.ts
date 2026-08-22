/** Undoable timeline track creation, removal, and state controls. */

import type { TimelineTrack } from '../../project/types';
import { execute } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { isTrackSyncLockActive } from '../utils/track-sync-lock';
import { pruneOrphanedTransitions } from './transitions.svelte';

export type TrackKind = NonNullable<TimelineTrack['kind']>;

function updateTrack(id: string, patch: Partial<TimelineTrack>, commandType: string): boolean {
	return execute(commandType, () => {
		const current = timelineStore.tracks.find((track) => track.id === id);
		if (!current) return false;
		timelineStore._setTracks(
			timelineStore.tracks.map((track) => (track.id === id ? { ...track, ...patch } : track))
		);
		return true;
	});
}

export function addTrack(kind: TrackKind, name: string): string {
	return execute('ADD_TRACK', () => {
		const orders = timelineStore.tracks.map((track) => track.order);
		const order =
			kind === 'video'
				? (orders.length > 0 ? Math.min(...orders) : 0) - 1
				: (orders.length > 0 ? Math.max(...orders) : -1) + 1;
		const track: TimelineTrack = {
			id: crypto.randomUUID(),
			name,
			kind,
			height: kind === 'video' ? 96 : 72,
			locked: false,
			syncLock: true,
			visible: true,
			muted: false,
			solo: false,
			volume: 1,
			order
		};
		timelineStore._setTracks([...timelineStore.tracks, track]);
		return track.id;
	});
}

export function removeTrack(id: string): boolean {
	if (timelineStore.tracks.length <= 1 || !timelineStore.tracks.some((track) => track.id === id)) {
		return false;
	}
	return execute('REMOVE_TRACK', () => {
		timelineStore._setTracks(timelineStore.tracks.filter((track) => track.id !== id));
		timelineStore._removeItems(
			timelineStore.items.filter((item) => item.trackId === id).map((item) => item.id)
		);
		pruneOrphanedTransitions();
		return true;
	});
}

export function toggleTrackLock(id: string): boolean {
	const track = timelineStore.tracks.find((candidate) => candidate.id === id);
	return track ? updateTrack(id, { locked: !track.locked }, 'TOGGLE_TRACK_LOCK') : false;
}

export function toggleTrackVisibility(id: string): boolean {
	const track = timelineStore.tracks.find((candidate) => candidate.id === id);
	return track ? updateTrack(id, { visible: !track.visible }, 'TOGGLE_TRACK_VISIBILITY') : false;
}

export function toggleTrackMute(id: string): boolean {
	const track = timelineStore.tracks.find((candidate) => candidate.id === id);
	return track ? updateTrack(id, { muted: !track.muted }, 'TOGGLE_TRACK_MUTE') : false;
}

export function toggleTrackSolo(id: string): boolean {
	const track = timelineStore.tracks.find((candidate) => candidate.id === id);
	return track ? updateTrack(id, { solo: !track.solo }, 'TOGGLE_TRACK_SOLO') : false;
}

export function toggleTrackSyncLock(id: string): boolean {
	const track = timelineStore.tracks.find((candidate) => candidate.id === id);
	return track
		? updateTrack(id, { syncLock: !isTrackSyncLockActive(track) }, 'TOGGLE_TRACK_SYNC_LOCK')
		: false;
}
