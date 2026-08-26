/**
 * End-to-end transcription action: stream a clip through the selected local
 * speech engine and convert word timings into cues on a subtitle
 * item as one undoable step.
 *
 * Ported from FreeCut (MIT) transcription flow, retargeted to OpenPost's
 * timeline store and cue model.
 */

import type { TimelineItem } from '../project/types';
import { m } from '$lib/paraglide/messages';
import { execute } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { buildCuesFromWords, type TranscriptWord } from './cues';
import { BrowserTranscriber } from './engine/transcriber';
import type { TranscribeOptions } from './engine/types';
import { isTrackEffectivelyLocked } from '../timeline/utils/track-groups';

export interface TranscriptionSourceWindow {
	sourceStartSeconds: number;
	sourceEndSeconds?: number;
}

export interface TranscriptionSourceSnapshot extends TranscriptionSourceWindow {
	itemId: string;
	mediaId: string;
	from: number;
	durationInFrames: number;
	sourceStart?: number;
	sourceEnd?: number;
	sourceFps: number;
	speed: number;
	isReversed: boolean;
}

export function transcriptionSourceWindow(
	item: TimelineItem,
	timelineFps = timelineStore.fps
): TranscriptionSourceWindow {
	const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : 30;
	const speed = item.speed && item.speed > 0 ? item.speed : 1;
	const sourceStartSeconds = Math.max(0, (item.sourceStart ?? 0) / sourceFps);
	const derivedSourceEnd =
		(item.sourceStart ?? 0) +
		(item.durationInFrames * speed * sourceFps) / Math.max(1, timelineFps);
	const sourceEndSeconds = Math.max(
		sourceStartSeconds,
		(item.sourceEnd ?? derivedSourceEnd) / sourceFps
	);
	return { sourceStartSeconds, sourceEndSeconds };
}

export function captureTranscriptionSource(item: TimelineItem): TranscriptionSourceSnapshot {
	const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : 30;
	const speed = item.speed && item.speed > 0 ? item.speed : 1;
	return {
		itemId: item.id,
		mediaId: item.mediaId ?? '',
		from: item.from,
		durationInFrames: item.durationInFrames,
		sourceStart: item.sourceStart,
		sourceEnd: item.sourceEnd,
		sourceFps,
		speed,
		isReversed: item.isReversed === true,
		...transcriptionSourceWindow(item)
	};
}

function sourceStillMatches(
	item: TimelineItem,
	expected: TranscriptionSourceWindow | TranscriptionSourceSnapshot
): boolean {
	const currentWindow = transcriptionSourceWindow(item);
	if (
		currentWindow.sourceStartSeconds !== expected.sourceStartSeconds ||
		currentWindow.sourceEndSeconds !== expected.sourceEndSeconds
	) {
		return false;
	}
	if (!('itemId' in expected)) return true;
	const current = captureTranscriptionSource(item);
	return (
		current.itemId === expected.itemId &&
		current.mediaId === expected.mediaId &&
		current.from === expected.from &&
		current.durationInFrames === expected.durationInFrames &&
		current.sourceStart === expected.sourceStart &&
		current.sourceEnd === expected.sourceEnd &&
		current.sourceFps === expected.sourceFps &&
		current.speed === expected.speed &&
		current.isReversed === expected.isReversed
	);
}

export async function transcribeClip(
	item: TimelineItem,
	file: File,
	options: TranscribeOptions = {}
): Promise<TranscriptWord[]> {
	const sourceWindow = transcriptionSourceWindow(item);
	const sourceStartSeconds = options.sourceStartSeconds ?? sourceWindow.sourceStartSeconds;
	const sourceEndSeconds = options.sourceEndSeconds ?? sourceWindow.sourceEndSeconds;
	const transcriber = new BrowserTranscriber();
	const segments = await transcriber
		.transcribe(file, { ...options, sourceStartSeconds, sourceEndSeconds })
		.collect();
	return segments.flatMap((segment) =>
		(segment.words ?? []).map((word) => ({
			text: word.text,
			startSeconds: word.start,
			endSeconds: word.end
		}))
	);
}

/** Create or replace the generated subtitle item for one exact clip source window. */
export function addGeneratedSubtitleItem(
	sourceItemId: string,
	words: TranscriptWord[],
	expectedSource?: TranscriptionSourceWindow | TranscriptionSourceSnapshot
): string {
	// SAFETY: execute returns the action's own string id unchanged.
	return execute('ADD_GENERATED_SUBTITLES', () => {
		const source = timelineStore.itemById.get(sourceItemId);
		if (!source) throw new Error('Source clip is gone');
		if (expectedSource && !sourceStillMatches(source, expectedSource)) {
			throw new Error(m.video_editor_transcribe_source_changed());
		}
		const fps = timelineStore.fps;
		const speed = source.speed && source.speed > 0 ? source.speed : 1;
		const { sourceStartSeconds } = transcriptionSourceWindow(source);
		const cues = buildCuesFromWords(words, { fps: fps / speed });
		if (cues.length === 0) throw new Error('Transcription produced no words');
		const matches = timelineStore.items.filter(
			(item) => item.captionSource?.type === 'transcript' && item.captionSource.clipId === source.id
		);
		if (matches.some((item) => isTrackEffectivelyLocked(item.trackId, timelineStore.tracks))) {
			throw new Error(m.video_editor_transcribe_unlock_existing());
		}
		const existing = matches[0];
		const topTrack =
			existing === undefined
				? timelineStore.tracks.find(
						(track) =>
							track.kind === 'video' && !isTrackEffectivelyLocked(track.id, timelineStore.tracks)
					)
				: undefined;
		if (!existing && !topTrack) throw new Error(m.video_editor_transcribe_unlock_track());
		const id = existing?.id ?? crypto.randomUUID();
		const nextItem = {
			...(existing ?? {}),
			id,
			trackId: existing?.trackId ?? topTrack!.id,
			from: source.from,
			durationInFrames: Math.min(
				source.durationInFrames,
				cues.reduce((max, cue) => Math.max(max, cue.endFrame), 0)
			),
			label: m.video_editor_transcribe(),
			type: 'subtitle',
			captionSource: {
				type: 'transcript',
				clipId: source.id,
				mediaId: source.mediaId ?? '',
				sourceStartSeconds,
				playbackSpeed: speed
			},
			cues
		} satisfies TimelineItem;
		const duplicateIds = new Set(matches.slice(1).map((item) => item.id));
		const nextItems = timelineStore.items
			.filter((item) => !duplicateIds.has(item.id))
			.map((item) => (item.id === id ? nextItem : item));
		if (!existing) nextItems.push(nextItem);
		timelineStore._setItems(nextItems);
		return id;
	}) as string;
}
