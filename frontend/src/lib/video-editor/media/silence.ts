/**
 * Silence removal flow: decode a clip's audio via mediabunny, run the
 * windowed-RMS detector, then apply the shared range-removal machinery as
 * one undo step.
 */

import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import type { AudioSilenceDetectionOptions } from '../audio/audio-silence';
import { detectSilentRanges } from '../audio/audio-silence';
import type { SourceRange } from '../timeline/actions/range-removal';
import { removeSilenceFromItems } from '../timeline/actions/range-removal';
import { mediaPool } from './pool.svelte';
import { resolveMediaBlob } from './import.svelte';
import type { TimelineItem } from '../project/types';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';

export interface RemoveSilenceOptions extends AudioSilenceDetectionOptions {
	/** 'signal' decodes audio; 'speech' derives gaps from the transcript. */
	mode?: 'signal' | 'speech';
}

/** Decode a media item's full audio into mono channel data for detection. */
async function decodeAudio(
	mediaId: string
): Promise<import('../audio/audio-silence').AudioBufferLike> {
	const media = mediaPool.get(mediaId);
	if (!media) throw new Error(`Unknown media: ${mediaId}`);
	const blob = await resolveMediaBlob(media);
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	const track = await input.getPrimaryAudioTrack();
	if (!track) throw new Error('No audio track');
	const sink = new AudioSampleSink(track);
	let totalFrames = 0;
	let sampleRate = 48000;
	const chunks: Float32Array[] = [];
	for await (const sample of sink.samples()) {
		sampleRate = sample.sampleRate;
		const buffer = sample.toAudioBuffer();
		// Downmix every channel into one mono array.
		const frames = buffer.length;
		const merged = new Float32Array(frames);
		for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
			const data = buffer.getChannelData(ch);
			for (let i = 0; i < frames; i++) merged[i] += (data[i] ?? 0) / buffer.numberOfChannels;
		}
		chunks.push(merged);
		totalFrames += frames;
		sample.close();
	}
	const channel = new Float32Array(Math.max(totalFrames, 1));
	let offset = 0;
	for (const chunk of chunks) {
		channel.set(chunk, offset);
		offset += chunk.length;
	}
	return {
		duration: channel.length / sampleRate,
		length: channel.length,
		numberOfChannels: 1,
		sampleRate,
		getChannelData: () => channel
	};
}

function toSourceRanges(ranges: Array<{ start: number; end: number }>): SourceRange[] {
	return ranges.map((r) => ({ start: r.start, end: r.end }));
}

/**
 * Detect + remove silence for the given timeline items ('signal' mode).
 * Speech mode arrives with the transcription feature; callers pass ranges
 * directly today.
 */
export async function removeSilenceSignal(
	itemIds: string[],
	options: RemoveSilenceOptions = {}
): Promise<number> {
	const { mode: _mode, ...detectorOptions } = options;
	const items = timelineItemsFor(itemIds);
	const byMedia = new Map<string, Array<{ start: number; end: number }>>();
	for (const item of items) {
		if (!item.mediaId || byMedia.has(item.mediaId)) continue;
		try {
			const buffer = await decodeAudio(item.mediaId);
			byMedia.set(item.mediaId, detectSilentRanges(buffer, detectorOptions));
		} catch {
			// Un-decodable audio (e.g. unsupported codec) — skip this media.
		}
	}
	const rangesByMediaId: Record<string, SourceRange[]> = {};
	for (const [mediaId, ranges] of byMedia) rangesByMediaId[mediaId] = toSourceRanges(ranges);

	const result = removeSilenceFromItems(itemIds, rangesByMediaId);
	return result.removedItemCount;
}

function timelineItemsFor(ids: string[]): TimelineItem[] {
	return ids
		.map((id) => timelineStore.itemById.get(id))
		.filter((item): item is TimelineItem => item !== undefined);
}
