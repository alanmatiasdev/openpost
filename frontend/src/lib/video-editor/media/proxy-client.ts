/**
 * Proxy media client. Generates and caches low-res proxy blobs per mediaId
 * so scrubbing large footage stays smooth. Mirrors the waveform-client
 * architecture: in-memory cache, inflight dedup, lazy import of
 * resolveMediaBlob, one worker per generation run.
 *
 * Memory tier ported from FreeCut (MIT): a size-bounded
 * least-recently-accessed cache replaces the unbounded Map.
 */

import type { MediaMetadata } from './types';
import type { ProxyRequest, ProxyWorkerResponse } from './proxy-worker';
import { SizedAccessedMemoryCache } from './sized-accessed-memory-cache';

export const PROXY_MAX_HEIGHT = 540;
export const PROXY_BITRATE = 1_000_000;

interface ProxyCacheEntry {
	blob: Blob | null;
	sizeBytes: number;
	lastAccessed: number;
}

const cache = new SizedAccessedMemoryCache<ProxyCacheEntry>(128 * 1024 * 1024);
const inflight = new Map<string, Promise<Blob>>();
const automaticInflight = new Map<string, Promise<Blob>>();
const cacheVersions = new Map<string, number>();
let automaticQueue: Promise<void> = Promise.resolve();

export interface ProxyDimensions {
	width: number;
	height: number;
}

/**
 * Keep ordinary HD clips on their source. Auto proxies target footage that is
 * costly to decode or seek, while the Full setting remains an explicit escape
 * hatch for machines that handle the source well.
 */
export function isAutomaticProxyCandidate(media: MediaMetadata): boolean {
	if (!media.mimeType.startsWith('video/')) return false;
	return (
		media.width > 1920 ||
		media.height > 1080 ||
		media.fps > 30 ||
		media.bitrate >= 12_000_000 ||
		media.fileSize >= 512 * 1024 * 1024 ||
		media.videoCodecSupported === false
	);
}

/** Compatibility proxies stay mandatory even when the user requests Full preview quality. */
export function shouldUseAutomaticProxy(
	media: MediaMetadata,
	previewQuality: 'auto' | 'full'
): boolean {
	if (media.videoCodecSupported === false) return true;
	return previewQuality === 'auto' && isAutomaticProxyCandidate(media);
}

/**
 * Pure sizing math: cap height at `maxHeight`, preserve aspect ratio, and
 * keep even dimensions (a codec requirement for VP9).
 */
export function proxyDimensions(
	width: number,
	height: number,
	maxHeight: number = PROXY_MAX_HEIGHT
): ProxyDimensions {
	if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
	const scale = Math.min(1, maxHeight / height);
	let nextWidth = Math.max(2, Math.round(width * scale));
	let nextHeight = Math.max(2, Math.round(height * scale));
	nextWidth -= nextWidth % 2;
	nextHeight -= nextHeight % 2;
	return { width: nextWidth, height: nextHeight };
}

/** The cached proxy blob for a media id, if one has been generated. */
export function cachedProxy(mediaId: string): Blob | null {
	return cache.get(mediaId)?.blob ?? null;
}

export async function getProxy(
	media: MediaMetadata,
	onProgress?: (progress: number) => void,
	signal?: AbortSignal
): Promise<Blob> {
	if (signal?.aborted) throw new DOMException('Proxy generation aborted', 'AbortError');
	const existing = cache.get(media.id);
	if (existing?.blob) return existing.blob;
	const pending = inflight.get(media.id);
	if (pending) return pending;
	const promise = encodeProxy(media, onProgress, signal).finally(() => inflight.delete(media.id));
	inflight.set(media.id, promise);
	return promise;
}

/** Serialize background proxy work so heavy clips do not compete for decoders. */
export function getAutomaticProxy(
	media: MediaMetadata,
	onProgress?: (progress: number) => void,
	signal?: AbortSignal
): Promise<Blob> {
	const pending = automaticInflight.get(media.id);
	if (pending) return pending;
	const request = automaticQueue
		.catch(() => undefined)
		.then(() => {
			if (signal?.aborted) throw new DOMException('Proxy generation aborted', 'AbortError');
			return getProxy(media, onProgress, signal);
		})
		.finally(() => automaticInflight.delete(media.id));
	automaticInflight.set(media.id, request);
	automaticQueue = request.then(
		() => undefined,
		() => undefined
	);
	return request;
}

async function encodeProxy(
	media: MediaMetadata,
	onProgress?: (progress: number) => void,
	signal?: AbortSignal
): Promise<Blob> {
	const cacheVersion = cacheVersions.get(media.id) ?? 0;
	const worker = new Worker(new URL('./proxy-worker.ts', import.meta.url), { type: 'module' });
	try {
		const { resolveMediaBlob } = await import('./resolve-media-blob');
		const file = await resolveMediaBlob(media);
		return await new Promise<Blob>((resolve, reject) => {
			const finish = (callback: () => void) => {
				signal?.removeEventListener('abort', abort);
				callback();
			};
			const abort = () =>
				finish(() => reject(new DOMException('Proxy generation aborted', 'AbortError')));
			signal?.addEventListener('abort', abort, { once: true });
			if (signal?.aborted) {
				abort();
				return;
			}
			worker.onmessage = (event: MessageEvent<ProxyWorkerResponse>) => {
				const message = event.data;
				if (message.type === 'complete') {
					if ((cacheVersions.get(media.id) ?? 0) === cacheVersion) {
						cache.add(media.id, {
							blob: message.blob,
							sizeBytes: message.blob.size,
							lastAccessed: Date.now()
						});
					}
					finish(() => resolve(message.blob));
					return;
				}
				if (message.type === 'progress') {
					onProgress?.(message.progress);
					return;
				}
				finish(() => reject(new Error(message.message ?? 'Proxy generation failed')));
			};
			worker.onerror = (event) =>
				finish(() => reject(new Error(event.message || 'Proxy worker failed')));
			worker.onmessageerror = () =>
				finish(() => reject(new Error('Proxy worker response could not be read')));
			const request: ProxyRequest = { file, maxHeight: PROXY_MAX_HEIGHT };
			worker.postMessage(request);
		});
	} catch (error) {
		cache.delete(media.id);
		throw error;
	} finally {
		worker.terminate();
	}
}

/** Drop one session proxy and prevent an older in-flight encode from restoring it. */
export function clearProxyCache(mediaId: string): boolean {
	const existed = cachedProxy(mediaId) !== null;
	cacheVersions.set(mediaId, (cacheVersions.get(mediaId) ?? 0) + 1);
	cache.delete(mediaId);
	return existed;
}
