/**
 * End-to-end transcription action: decode a clip's audio to 16 kHz mono,
 * run the Whisper worker, and convert word timings into cues on a subtitle
 * item as one undoable step.
 *
 * Ported from FreeCut (MIT) transcription flow, retargeted to OpenPost's
 * timeline store and cue model.
 */

import { Input, AudioSampleSink, ALL_FORMATS, BlobSource } from 'mediabunny';
import type { TimelineItem } from '../project/types';
import { execute } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { buildCuesFromWords, type TranscriptWord } from './cues';
import { transcribeAudio } from './transcribe-client';
import { WHISPER_SAMPLE_RATE } from './chunker';

/** Decode the media's primary audio track to mono at any rate. */
export async function decodeAudioToMono(
	file: File
): Promise<{ buffer: Float32Array; sampleRate: number }> {
	const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
	const track = await input.getPrimaryAudioTrack();
	if (!track) throw new Error('This clip has no audio to transcribe');
	const sink = new AudioSampleSink(track);
	const chunks: Float32Array[] = [];
	let total = 0;
	for await (const sample of sink.samples()) {
		try {
			// SAFETY: copyTo fills a planar f32 view of the decoded sample.
			const plane = new Float32Array(sample.numberOfFrames);
			sample.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
			chunks.push(plane);
			total += plane.length;
		} finally {
			sample.close();
		}
	}
	const merged = new Float32Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.length;
	}
	return { buffer: merged, sampleRate: track.sampleRate || 48_000 };
}

export interface TranscribeProgress {
	onProgress?: (progress: number) => void;
}

export async function transcribeClip(
	item: TimelineItem,
	file: File,
	options: TranscribeProgress = {}
): Promise<TranscriptWord[]> {
	const { buffer, sampleRate } = await decodeAudioToMono(file);
	return transcribeAudio(buffer, sampleRate, buffer.length / WHISPER_SAMPLE_RATE, {
		onProgress: options.onProgress
	});
}

/** Create the subtitle item holding generated cues for a transcribed clip. */
export function addGeneratedSubtitleItem(sourceItemId: string, words: TranscriptWord[]): string {
	// SAFETY: execute returns the action's own string id unchanged.
	return execute('ADD_GENERATED_SUBTITLES', () => {
		const source = timelineStore.itemById.get(sourceItemId);
		if (!source) throw new Error('Source clip is gone');
		const fps = timelineStore.fps;
		const cues = buildCuesFromWords(words, { fps });
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
