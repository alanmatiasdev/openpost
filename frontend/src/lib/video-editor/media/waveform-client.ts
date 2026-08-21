/**
 * Ported from FreeCut (MIT) — waveform service client. Caches peak arrays
 * per mediaId so timeline rerenders reuse decoded audio.
 */

import type { MediaMetadata } from './types';
import type { WaveformCompleteMessage, WaveformWorkerResponse } from './waveform-worker';

export interface WaveformData {
	peaks: Float32Array;
	durationSeconds: number;
	samplesPerSecond: number;
}

const cache = new Map<string, WaveformMetadata>();
const inflight = new Map<string, Promise<WaveformData>>();

interface WaveformMetadata {
	data: WaveformData | null;
	error?: string;
}

const SAMPLES_PER_SECOND = 50;

export function cachedWaveform(mediaId: string): WaveformData | null {
	return cache.get(mediaId)?.data ?? null;
}

export async function getWaveform(media: MediaMetadata): Promise<WaveformData> {
	const existing = cache.get(media.id);
	if (existing?.data) return existing.data;
	if (existing) {
		throw new Error(existing.error ?? 'Waveform unavailable');
	}
	const pending = inflight.get(media.id);
	if (pending) return pending;
	const promise = decode(media).finally(() => inflight.delete(media.id));
	inflight.set(media.id, promise);
	return promise;
}

async function decode(media: MediaMetadata): Promise<WaveformData> {
	const worker = new Worker(new URL('./waveform-worker.ts', import.meta.url), {
		type: 'module'
	});
	try {
		const { resolveMediaBlob } = await import('./import.svelte');
		const file = await resolveMediaBlob(media);
		return await new Promise<WaveformData>((resolve, reject) => {
			worker.onmessage = (event: MessageEvent<WaveformWorkerResponse>) => {
				// SAFETY: the worker's error branch posts {type:'error',message}, not a Response variant.
				const message = event.data as WaveformWorkerResponse & { type: string; message?: string };
				if (message.type === 'complete') {
					const data: WaveformData = {
						peaks: message.peaks,
						durationSeconds: message.durationSeconds,
						samplesPerSecond: SAMPLES_PER_SECOND
					};
					cache.set(media.id, { data });
					resolve(data);
					return;
				}
				cache.set(media.id, { data: null, error: message.message ?? 'decode failed' });
				reject(new Error(message.message ?? 'Waveform decoding failed'));
			};
			worker.onerror = (event) => reject(new Error(event.message));
			worker.postMessage({ file, samplesPerSecond: SAMPLES_PER_SECOND });
		});
	} catch (error) {
		cache.set(media.id, {
			data: null,
			error: error instanceof Error ? error.message : String(error)
		});
		throw error;
	} finally {
		worker.terminate();
	}
}
