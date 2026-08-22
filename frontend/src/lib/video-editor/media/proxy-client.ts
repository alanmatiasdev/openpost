/**
 * Proxy media client. Generates and caches low-res proxy blobs per mediaId
 * so scrubbing large footage stays smooth. Mirrors the waveform-client
 * architecture: in-memory cache, inflight dedup, lazy import of
 * resolveMediaBlob, one worker per generation run.
 */

import type { MediaMetadata } from './types';
import type { ProxyRequest, ProxyWorkerResponse } from './proxy-worker';

export const PROXY_MAX_HEIGHT = 480;
export const PROXY_BITRATE = 600_000;

const cache = new Map<string, { blob: Blob | null; error?: string }>();
const inflight = new Map<string, Promise<Blob>>();

export interface ProxyDimensions {
	width: number;
	height: number;
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
	onProgress?: (progress: number) => void
): Promise<Blob> {
	const existing = cache.get(media.id);
	if (existing?.blob) return existing.blob;
	if (existing) throw new Error(existing.error ?? 'Proxy unavailable');
	const pending = inflight.get(media.id);
	if (pending) return pending;
	const promise = encodeProxy(media, onProgress).finally(() => inflight.delete(media.id));
	inflight.set(media.id, promise);
	return promise;
}

async function encodeProxy(
	media: MediaMetadata,
	onProgress?: (progress: number) => void
): Promise<Blob> {
	const worker = new Worker(new URL('./proxy-worker.ts', import.meta.url), { type: 'module' });
	try {
		const { resolveMediaBlob } = await import('./import.svelte');
		const file = await resolveMediaBlob(media);
		return await new Promise<Blob>((resolve, reject) => {
			worker.onmessage = (event: MessageEvent<ProxyWorkerResponse>) => {
				const message = event.data;
				if (message.type === 'complete') {
					cache.set(media.id, { blob: message.blob });
					resolve(message.blob);
					return;
				}
				if (message.type === 'progress') {
					onProgress?.(message.progress);
					return;
				}
				cache.set(media.id, { blob: null, error: message.message });
				reject(new Error(message.message ?? 'Proxy generation failed'));
			};
			worker.onerror = (event) => reject(new Error(event.message));
			const request: ProxyRequest = { file, maxHeight: PROXY_MAX_HEIGHT };
			worker.postMessage(request);
		});
	} catch (error) {
		cache.set(media.id, {
			blob: null,
			error: error instanceof Error ? error.message : String(error)
		});
		throw error;
	} finally {
		worker.terminate();
	}
}
