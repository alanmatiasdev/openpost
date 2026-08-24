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
import { removeOpfsEntry } from './opfs-cache';

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
const cacheVersions = new Map<string, number>();
const pendingPersistence = new Map<string, Promise<void>>();

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
	const version = cacheVersions.get(media.id) ?? 0;
	const promise = loadOrDecode(media, version);
	inflight.set(media.id, promise);
	const clearInflight = () => {
		if (inflight.get(media.id) === promise) inflight.delete(media.id);
	};
	void promise.then(clearInflight, clearInflight);
	return promise;
}

function cacheIsCurrent(mediaId: string, version: number): boolean {
	return (cacheVersions.get(mediaId) ?? 0) === version;
}

async function loadOrDecode(media: MediaMetadata, version: number): Promise<WaveformData> {
	const persisted = await loadWaveform(media.id);
	if (persisted) {
		if (cacheIsCurrent(media.id, version)) {
			cache.add(media.id, {
				data: persisted,
				sizeBytes: persisted.peaks.byteLength,
				lastAccessed: Date.now()
			});
		}
		return persisted;
	}
	const decoded = await decode(media, version);
	if (cacheIsCurrent(media.id, version)) {
		void queueWaveformPersistence(media.id, version, decoded);
	}
	return decoded;
}

function queueWaveformPersistence(
	mediaId: string,
	version: number,
	data: WaveformData
): Promise<void> {
	const pending = pendingPersistence.get(mediaId) ?? Promise.resolve();
	const next = pending
		.catch(() => undefined)
		.then(async () => {
			if (!cacheIsCurrent(mediaId, version)) return;
			await saveWaveform(mediaId, data);
		})
		.catch(() => undefined);
	pendingPersistence.set(mediaId, next);
	void next.then(() => {
		if (pendingPersistence.get(mediaId) === next) pendingPersistence.delete(mediaId);
	});
	return next;
}

async function decode(media: MediaMetadata, version: number): Promise<WaveformData> {
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
					if (cacheIsCurrent(media.id, version)) {
						cache.add(media.id, {
							data,
							sizeBytes: message.peaks.byteLength,
							lastAccessed: Date.now()
						});
					}
					resolve(data);
					return;
				}
				if (cacheIsCurrent(media.id, version)) {
					cache.add(media.id, {
						data: null,
						error: message.message ?? 'decode failed',
						sizeBytes: 0,
						lastAccessed: Date.now()
					});
				}
				reject(new Error(message.message ?? 'Waveform decoding failed'));
			};
			worker.onerror = (event) => reject(new Error(event.message));
			worker.postMessage({ file, samplesPerSecond: SAMPLES_PER_SECOND });
		});
	} catch (error) {
		if (cacheIsCurrent(media.id, version)) {
			cache.add(media.id, {
				data: null,
				error: error instanceof Error ? error.message : String(error),
				sizeBytes: 0,
				lastAccessed: Date.now()
			});
		}
		throw error;
	} finally {
		worker.terminate();
	}
}

/** Clear one media item's derived waveform without touching source bytes. */
export async function clearWaveformCache(mediaId: string): Promise<void> {
	cacheVersions.set(mediaId, (cacheVersions.get(mediaId) ?? 0) + 1);
	cache.delete(mediaId);
	inflight.delete(mediaId);
	await pendingPersistence.get(mediaId)?.catch(() => undefined);
	await removeOpfsEntry('waveforms', mediaId);
}
