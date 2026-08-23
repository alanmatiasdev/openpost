/**
 * End-to-end transcription action: stream a clip through the selected local
 * speech engine and convert word timings into cues on a subtitle
 * item as one undoable step.
 *
 * Ported from FreeCut (MIT) transcription flow, retargeted to OpenPost's
 * timeline store and cue model.
 */

import type { TimelineItem } from '../project/types';
import { execute } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { buildCuesFromWords, type TranscriptWord } from './cues';
import { BrowserTranscriber } from './engine/transcriber';
import type { TranscribeOptions } from './engine/types';

export function transcriptionSourceWindow(item: TimelineItem): {
	sourceStartSeconds: number;
	sourceEndSeconds?: number;
} {
	const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : 30;
	const sourceStartSeconds = Math.max(0, (item.sourceStart ?? 0) / sourceFps);
	const sourceEndSeconds =
		item.sourceEnd == null ? undefined : Math.max(sourceStartSeconds, item.sourceEnd / sourceFps);
	return { sourceStartSeconds, sourceEndSeconds };
}

export async function transcribeClip(
	item: TimelineItem,
	file: File,
	options: TranscribeOptions = {}
): Promise<TranscriptWord[]> {
	const { sourceStartSeconds, sourceEndSeconds } = transcriptionSourceWindow(item);
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

/** Create the subtitle item holding generated cues for a transcribed clip. */
export function addGeneratedSubtitleItem(sourceItemId: string, words: TranscriptWord[]): string {
	// SAFETY: execute returns the action's own string id unchanged.
	return execute('ADD_GENERATED_SUBTITLES', () => {
		const source = timelineStore.itemById.get(sourceItemId);
		if (!source) throw new Error('Source clip is gone');
		const fps = timelineStore.fps;
		const speed = source.speed && source.speed > 0 ? source.speed : 1;
		const cues = buildCuesFromWords(words, { fps: fps / speed });
		if (cues.length === 0) throw new Error('Transcription produced no words');
		const topTrack =
			timelineStore.tracks.find((track) => track.kind === 'video') ?? timelineStore.tracks[0]!;
		const id = crypto.randomUUID();
		timelineStore._setItems([
			...timelineStore.items,
			{
				id,
				trackId: topTrack.id,
				from: source.from,
				durationInFrames: Math.min(
					source.durationInFrames,
					cues.reduce((max, cue) => Math.max(max, cue.endFrame), 0)
				),
				label: 'Auto captions',
				type: 'subtitle',
				captionSource: { type: 'transcript', clipId: source.id, mediaId: source.mediaId ?? '' },
				cues
			} satisfies TimelineItem
		]);
		return id;
	}) as string;
}
