/**
 * Ported from FreeCut (MIT) — waveform service client. Caches peak arrays
 * per mediaId so timeline rerenders reuse decoded audio.
 *
 * Memory tier ported from FreeCut's waveform-cache.ts: a size-bounded
 * least-recently-accessed cache replaces the unbounded Map, so long sessions
 * evict stale peaks instead of growing without limit.
 */

import type { MediaMetadata } from './types';
import type { WaveformCompleteMessage, WaveformWorkerResponse } from './waveform-worker';
import { SizedAccessedMemoryCache } from './sized-accessed-memory-cache';
import { loadWaveform, saveWaveform } from './waveform-persistence';

export interface WaveformData {
	peaks: Float32Array;
	durationSeconds: number;
	samplesPerSecond: number;
}

interface WaveformMetadata {
	data: WaveformData | null;
	error?: string;
	sizeBytes: number;
	lastAccessed: number;
}

const cache = new SizedAccessedMemoryCache<WaveformMetadata>(64 * 1024 * 1024);
const inflight = new Map<string, Promise<WaveformData>>();

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
	const promise = loadOrDecode(media).finally(() => inflight.delete(media.id));
	inflight.set(media.id, promise);
	return promise;
}

async function loadOrDecode(media: MediaMetadata): Promise<WaveformData> {
	const persisted = await loadWaveform(media.id);
	if (persisted) {
		cache.add(media.id, {
			data: persisted,
			sizeBytes: persisted.peaks.byteLength,
			lastAccessed: Date.now()
		});
		return persisted;
	}
	const decoded = await decode(media);
	void saveWaveform(media.id, decoded);
	return decoded;
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
					cache.add(media.id, {
						data,
						sizeBytes: message.peaks.byteLength,
						lastAccessed: Date.now()
					});
					resolve(data);
					return;
				}
				cache.add(media.id, {
					data: null,
					error: message.message ?? 'decode failed',
					sizeBytes: 0,
					lastAccessed: Date.now()
				});
				reject(new Error(message.message ?? 'Waveform decoding failed'));
			};
			worker.onerror = (event) => reject(new Error(event.message));
			worker.postMessage({ file, samplesPerSecond: SAMPLES_PER_SECOND });
		});
	} catch (error) {
		cache.add(media.id, {
			data: null,
			error: error instanceof Error ? error.message : String(error),
			sizeBytes: 0,
			lastAccessed: Date.now()
		});
		throw error;
	} finally {
		worker.terminate();
	}
}
