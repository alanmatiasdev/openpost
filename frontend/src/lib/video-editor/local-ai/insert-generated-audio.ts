import type { MediaMetadata } from '../media/types';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { execute } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';

/**
 * Add generated audio to a fresh audio track at the captured playhead. The track and clip
 * share one command so one undo removes both.
 */
export function insertGeneratedAudioOnNewTrack(
	media: MediaMetadata,
	playheadFrame: number
): string {
	return execute('INSERT_GENERATED_AUDIO', () => {
		const from = Number.isFinite(playheadFrame) ? Math.max(0, Math.round(playheadFrame)) : 0;
		const fps = timelineStore.fps;
		const sourceFps = media.fps > 0 ? media.fps : fps;
		const durationInFrames = Math.max(1, Math.round(media.duration * fps));
		const sourceDuration = Math.max(1, Math.round(media.duration * sourceFps));
		const audioTrackCount = timelineStore.tracks.filter((track) => track.kind === 'audio').length;
		const order =
			(timelineStore.tracks.length > 0
				? Math.max(...timelineStore.tracks.map((track) => track.order))
				: -1) + 1;
		const track: TimelineTrack = {
			id: crypto.randomUUID(),
			name: `Audio ${audioTrackCount + 1}`,
			kind: 'audio',
			height: 72,
			locked: false,
			syncLock: true,
			visible: true,
			muted: false,
			solo: false,
			volume: 1,
			order
		};
		const item: TimelineItem = {
			id: crypto.randomUUID(),
			trackId: track.id,
			from,
			durationInFrames,
			label: media.fileName,
			type: 'audio',
			mediaId: media.id,
			originId: crypto.randomUUID(),
			sourceStart: 0,
			sourceEnd: sourceDuration,
			sourceDuration,
			sourceFps,
			volume: 1
		};

		timelineStore._setTracks([...timelineStore.tracks, track]);
		timelineStore._addItem(item);
		return item.id;
	});
}
