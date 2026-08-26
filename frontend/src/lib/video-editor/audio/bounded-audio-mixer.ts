import type { MixEntry } from '../media/render-plan';
import { mediaPool } from '../media/pool.svelte';
import { resolveMediaBlob } from '../media/resolve-media-blob';
import { reverseAudioWindow } from './reverse-audio';
import { processAudioChannels } from './process-audio';
import { downmixToOutputChannels, resampleChannelLinear } from './sample-rate-converter';
import { buildTransitionGainCurve } from './transition-crossfade';
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import { ensureAc3DecoderForCodec } from '../media/ac3-decoder';

const MIX_SAMPLE_RATE = 48_000;
const MIX_CHANNELS = 2;
const WINDOW_SECONDS = 30;
const WINDOW_SAMPLES = WINDOW_SECONDS * MIX_SAMPLE_RATE;

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

function gainAtTime(points: { whenSeconds: number; value: number }[], time: number): number {
	if (points.length === 0) return 1;
	const sorted = points.toSorted((a, b) => a.whenSeconds - b.whenSeconds);
	if (time <= sorted[0]!.whenSeconds) return Math.max(0, sorted[0]!.value);
	for (let i = 1; i < sorted.length; i++) {
		const right = sorted[i]!;
		if (time > right.whenSeconds) continue;
		const left = sorted[i - 1]!;
		const duration = right.whenSeconds - left.whenSeconds;
		if (duration <= 0) return Math.max(0, right.value);
		const progress = (time - left.whenSeconds) / duration;
		return Math.max(0, left.value + (right.value - left.value) * progress);
	}
	return Math.max(0, sorted[sorted.length - 1]!.value);
}

function transitionGainAtTime(entry: MixEntry, time: number, sampleRate: number): number {
	let gain = 1;
	for (const span of entry.transitionGainSpans) {
		const spanEnd = span.startSeconds + span.durationSeconds;
		if (time < span.startSeconds || time >= spanEnd || span.durationSeconds <= 0) continue;
		const progress = (time - span.startSeconds) / span.durationSeconds;
		// Use the same curve as the OfflineAudioContext path for parity
		// Build a tiny curve on the fly instead of per-window OfflineAudioContext
		// To stay bounded and avoid per-sample curve generation, approximate with
		// equal-power for crossfades; the exact curve is built once per entry via
		// buildTransitionGainCurve for the whole entry and sampled here via linear
		const curve = buildTransitionGainCurve(span, span.startSeconds, spanEnd, sampleRate);
		const idx = Math.min(curve.length - 1, Math.max(0, Math.floor(progress * curve.length)));
		gain *= curve[idx] ?? 1;
	}
	return gain;
}

async function decodeSourceSlice(
	blob: Blob,
	startSeconds: number,
	endSeconds: number,
	signal?: AbortSignal
): Promise<{ channels: Float32Array[]; sampleRate: number }> {
	throwIfAborted(signal);
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	let sink: AudioSampleSink | null = null;
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error('No audio');
		await ensureAc3DecoderForCodec(track.codec);
		sink = new AudioSampleSink(track);
		const chunks: Float32Array[][] = [];
		let totalFrames = 0;
		let sampleRate = track.sampleRate || MIX_SAMPLE_RATE;
		const start = Math.max(0, startSeconds);
		const end = Math.max(start, endSeconds);
		for await (const sample of sink.samples(start, end)) {
			throwIfAborted(signal);
			sampleRate = sample.sampleRate || sampleRate;
			const frameCount = sample.numberOfFrames;
			const planes: Float32Array[] = [];
			for (let c = 0; c < sample.numberOfChannels; c++) {
				const plane = new Float32Array(frameCount);
				sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
				planes.push(plane);
			}
			chunks.push(planes);
			totalFrames += frameCount;
			if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		}
		if (totalFrames === 0) return { channels: [], sampleRate };
		const channelsCount = chunks[0]?.length ?? 1;
		const out: Float32Array[] = Array.from(
			{ length: channelsCount },
			() => new Float32Array(totalFrames)
		);
		let offset = 0;
		for (const planes of chunks) {
			for (let c = 0; c < channelsCount; c++) {
				out[c]!.set(planes[c] ?? planes[0] ?? new Float32Array(0), offset);
			}
			offset += planes[0]?.length ?? 0;
		}
		return { channels: out, sampleRate };
	} finally {
		try {
			sink?.close?.();
		} catch {}
		input.dispose?.();
	}
}

function isSimpleEntry(entry: MixEntry): boolean {
	return (
		Math.abs(entry.playbackRate - 1) <= 0.0001 &&
		!entry.reversed &&
		Math.abs(entry.pitchShiftSemitones) <= 0.0001 &&
		(entry.audioEqStages?.length ?? 0) === 0
	);
}

export async function* mixAudioWindows(
	entries: MixEntry[],
	durationSeconds: number,
	signal?: AbortSignal
): AsyncGenerator<{ samples: Float32Array[]; sampleRate: number; channels: number }> {
	throwIfAborted(signal);
	if (entries.length === 0 || durationSeconds <= 0) return;
	const totalSamples = Math.ceil(durationSeconds * MIX_SAMPLE_RATE);
	const useWindowed = entries.every(isSimpleEntry);
	const windowSize = useWindowed ? WINDOW_SAMPLES : totalSamples;
	let anySuccessfulMix = false;
	// One output owner: this generator yields windows sequentially; the caller feeds them to a single AudioSampleSource.
	for (let windowStart = 0; windowStart < totalSamples; windowStart += windowSize) {
		throwIfAborted(signal);
		const windowEnd = Math.min(totalSamples, windowStart + windowSize);
		const windowLength = windowEnd - windowStart;
		const windowMix: Float32Array[] = [
			new Float32Array(windowLength),
			new Float32Array(windowLength)
		];
		for (const entry of entries) {
			const entryStart = Math.floor(entry.whenSeconds * MIX_SAMPLE_RATE);
			const entryEnd = entryStart + Math.ceil(entry.durationSeconds * MIX_SAMPLE_RATE);
			const overlapStart = Math.max(windowStart, entryStart);
			const overlapEnd = Math.min(windowEnd, entryEnd);
			if (overlapEnd <= overlapStart) continue;
			const overlapLength = overlapEnd - overlapStart;
			const deltaStart = (overlapStart - entryStart) / MIX_SAMPLE_RATE;
			const overlapSeconds = overlapLength / MIX_SAMPLE_RATE;
			let sourceStart: number;
			let sourceEnd: number;
			if (entry.reversed) {
				const end = entry.sourceOffsetSeconds;
				sourceEnd = end - deltaStart * entry.playbackRate;
				sourceStart = sourceEnd - overlapSeconds * entry.playbackRate;
			} else {
				sourceStart = entry.sourceOffsetSeconds + deltaStart * entry.playbackRate;
				sourceEnd = sourceStart + overlapSeconds * entry.playbackRate;
			}
			const media = mediaPool.get(entry.mediaId);
			if (!media) continue;
			let decoded: { channels: Float32Array[]; sampleRate: number };
			try {
				decoded = await decodeSourceSlice(
					await resolveMediaBlob(media),
					sourceStart,
					sourceEnd,
					signal
				);
			} catch (error) {
				if (error instanceof DOMException && error.name === 'AbortError') throw error;
				continue;
			}
			if (decoded.channels.length === 0 || decoded.channels[0]!.length === 0) continue;
			let channels = decoded.channels;
			if (entry.reversed) {
				const tmp = { channels, sampleRate: decoded.sampleRate } as unknown as {
					length: number;
					numberOfChannels: number;
					sampleRate: number;
					getChannelData: (c: number) => Float32Array;
				};
				// Use reverse helper via temporary AudioBuffer-like object
				const reversed = reverseAudioWindow(
					{
						length: channels[0]!.length,
						numberOfChannels: channels.length,
						sampleRate: decoded.sampleRate,
						getChannelData: (c: number) => channels[c]!
					} as unknown as import('./reverse-audio').DecodedAudioWindowSource,
					channels[0]!.length / decoded.sampleRate,
					channels[0]!.length / decoded.sampleRate
				);
				channels = reversed.channels;
			}
			// Speed/pitch/EQ: for windowed simple path this is a no-op; for complex entries we process per-window slice
			// To keep bounded, we process per-window slice independently. For long complex clips this may cause
			// slight WSOLA discontinuity at window boundaries, which is documented as remaining limit.
			if (!isSimpleEntry(entry)) {
				try {
					channels = await processAudioChannels(channels, {
						speed: entry.playbackRate,
						pitchShiftSemitones: entry.pitchShiftSemitones,
						sampleRate: decoded.sampleRate,
						eqStages: entry.audioEqStages
					});
				} catch (error) {
					if (error instanceof DOMException && error.name === 'AbortError') throw error;
					continue;
				}
			}
			// Resample to MIX_SAMPLE_RATE if needed - use absolute-phase per window via expectedOutputFrames
			if (decoded.sampleRate !== MIX_SAMPLE_RATE) {
				const resampled: Float32Array[] = [];
				for (const ch of channels) {
					let r = resampleChannelLinear(ch, decoded.sampleRate, MIX_SAMPLE_RATE);
					if (r.length !== overlapLength) {
						// Trim or pad to exact overlapLength to keep window alignment
						if (r.length > overlapLength) r = r.slice(0, overlapLength);
						else {
							const padded = new Float32Array(overlapLength);
							padded.set(r, 0);
							r = padded;
						}
					}
					resampled.push(r);
				}
				channels = resampled;
			} else if (channels[0]!.length !== overlapLength) {
				// Native rate but length mismatch due to rounding - trim/pad
				channels = channels.map((ch) => {
					if (ch.length === overlapLength) return ch;
					if (ch.length > overlapLength) return ch.slice(0, overlapLength);
					const padded = new Float32Array(overlapLength);
					padded.set(ch, 0);
					return padded;
				});
			}
			const mapped = downmixToOutputChannels(channels, MIX_CHANNELS);
			const windowOffset = overlapStart - windowStart;
			for (let c = 0; c < MIX_CHANNELS; c++) {
				const src = mapped[c] ?? mapped[0] ?? new Float32Array(0);
				const dest = windowMix[c]!;
				for (let i = 0; i < overlapLength; i++) {
					const timelineTime = (overlapStart + i) / MIX_SAMPLE_RATE;
					const gain =
						gainAtTime(entry.gainPoints, timelineTime) *
						transitionGainAtTime(entry, timelineTime, MIX_SAMPLE_RATE);
					dest[windowOffset + i]! += (src[i] ?? 0) * gain;
				}
			}
			anySuccessfulMix = true;
		}
		// Soft clip like FreeCut
		for (const ch of windowMix) {
			for (let i = 0; i < ch.length; i++) if (Math.abs(ch[i]!) > 1) ch[i] = Math.tanh(ch[i]!);
		}
		yield { samples: windowMix, sampleRate: MIX_SAMPLE_RATE, channels: MIX_CHANNELS };
	}
	if (!anySuccessfulMix && entries.length > 0) throw new Error('The audio mix is empty.');
}

export function mixDurationSeconds(entries: MixEntry[]): number {
	return entries.reduce((max, e) => Math.max(max, e.whenSeconds + e.durationSeconds), 0);
}
