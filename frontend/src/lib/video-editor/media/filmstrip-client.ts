/**
 * Ported from FreeCut (MIT) — timeline/services/filmstrip-cache.ts,
 * trimmed to OpenPost's needs:
 * - Managed worker pool + warm preboot (kept).
 * - Memory budget with LRU eviction via SizedAccessedMemoryCache (kept;
 *   FreeCut's FilmstripMemoryState is the same shape).
 * - Idle eviction of entries with no subscribers (kept).
 * - Concurrency limits by core count + queue scored by remaining frames (kept).
 * - Throttled progressive notify (kept).
 * - OPFS frame and index persistence with ImageBitmap hydration (adapted).
 * - Skipped: priority-window refinement phases and exact-target merge/restart
 *   machinery.
 */

import type { MediaMetadata } from './types';
import {
	buildTargetIndices,
	FILMSTRIP_EXTRACT_HEIGHT,
	FILMSTRIP_EXTRACT_WIDTH,
	FILMSTRIP_FRAME_RATE,
	type FrameRange
} from './filmstrip-plan';
import { SizedAccessedMemoryCache } from './sized-accessed-memory-cache';
import { createManagedWorkerPool } from './managed-worker-pool';
import type {
	FilmstripExtractRequest,
	FilmstripWorkerResponse
} from './filmstrip-extraction.worker';
import { loadFilmstrip, saveFilmstripFrame, saveFilmstripIndex } from './filmstrip-persistence';
import { removeOpfsEntry } from './opfs-cache';

export interface FilmstripFrame {
	index: number;
	url: string | null;
	bitmap?: ImageBitmap;
}

export interface Filmstrip {
	frames: FilmstripFrame[];
	isComplete: boolean;
	isExtracting: boolean;
	progress: number;
}

interface FilmstripCacheEntry {
	sizeBytes: number;
	lastAccessed: number;
	filmstrip: Filmstrip;
}

type FilmstripUpdateCallback = (filmstrip: Filmstrip) => void;

const MEMORY_SOFT_LIMIT_BYTES = 256 * 1024 * 1024;
const CACHE_EVICT_IDLE_MS = 15_000;
const PROGRESS_NOTIFY_INTERVAL_MS = 200;
const MAX_IDLE_WORKERS = 2;
const HIGH_CORE_THRESHOLD = 12;
const MAX_CONCURRENT_EXTRACTIONS_BASE = 1;
const MAX_CONCURRENT_EXTRACTIONS_HIGH_CORE = 2;
/** Rough decoded cost of one extracted thumbnail, for LRU accounting. */
const ESTIMATED_FRAME_BYTES = FILMSTRIP_EXTRACT_WIDTH * FILMSTRIP_EXTRACT_HEIGHT * 4;

function estimatedFilmstripBytes(filmstrip: Filmstrip): number {
	return filmstrip.frames.length * ESTIMATED_FRAME_BYTES;
}

function hardwareCoreCount(): number {
	const cores = globalThis.navigator?.hardwareConcurrency;
	return cores > 0 ? cores : 4;
}

function getMaxConcurrentExtractions(): number {
	return hardwareCoreCount() >= HIGH_CORE_THRESHOLD
		? MAX_CONCURRENT_EXTRACTIONS_HIGH_CORE
		: MAX_CONCURRENT_EXTRACTIONS_BASE;
}

class FilmstripCacheService {
	private cache = new SizedAccessedMemoryCache<FilmstripCacheEntry>(MEMORY_SOFT_LIMIT_BYTES);
	private pendingExtractions = new Map<
		string,
		{ requestId: string; targetIndices: number[]; frames: Map<number, string | null> }
	>();
	private loadingPromises = new Map<string, Promise<Filmstrip>>();
	private updateCallbacks = new Map<string, Set<FilmstripUpdateCallback>>();
	private extractionQueue: string[] = [];
	private pendingQueueStarts = new Map<string, () => void>();
	private activeExtractions = new Set<string>();
	private requestSeq = 0;
	private lastMemoryCheckAt = 0;
	private prewarmStarted = false;
	private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private lastNotifyAt = new Map<string, number>();
	private cacheVersions = new Map<string, number>();
	private pendingPersistence = new Map<string, Promise<void>>();

	private readonly workerPool = createManagedWorkerPool({
		createWorker: () =>
			new Worker(new URL('./filmstrip-extraction.worker.ts', import.meta.url), { type: 'module' }),
		resetWorker: (worker) => {
			worker.onmessage = null;
			worker.onerror = null;
		}
	});

	/** Eagerly boot one extraction worker so the first extraction skips boot latency. */
	prewarm(): void {
		if (this.prewarmStarted) return;
		this.prewarmStarted = true;
		try {
			const worker = this.workerPool.acquireWorker();
			const requestId = `warm-${++this.requestSeq}`;
			const onMessage = (event: MessageEvent<FilmstripWorkerResponse>) => {
				if (event.data.type !== 'warmed' || event.data.requestId !== requestId) return;
				worker.removeEventListener('message', onMessage);
				this.workerPool.releaseWorker(worker, { maxIdleWorkers: MAX_IDLE_WORKERS });
			};
			worker.addEventListener('message', onMessage);
			worker.postMessage({ type: 'warm', requestId });
		} catch {
			this.prewarmStarted = false;
		}
	}

	cachedFilmstrip(mediaId: string): Filmstrip | null {
		return this.cache.get(mediaId)?.filmstrip ?? null;
	}

	hasPendingExtraction(mediaId: string): boolean {
		return this.pendingExtractions.has(mediaId) || this.loadingPromises.has(mediaId);
	}

	subscribe(mediaId: string, callback: FilmstripUpdateCallback): () => void {
		this.prewarm();
		this.clearIdleTimer(mediaId);
		let callbacks = this.updateCallbacks.get(mediaId);
		if (!callbacks) {
			callbacks = new Set();
			this.updateCallbacks.set(mediaId, callbacks);
		}
		callbacks.add(callback);

		const current = this.cachedFilmstrip(mediaId);
		if (current) callback(current);

		return () => {
			const set = this.updateCallbacks.get(mediaId);
			if (!set) return;
			set.delete(callback);
			if (set.size === 0) {
				this.updateCallbacks.delete(mediaId);
				this.scheduleIdleEviction(mediaId);
			}
		};
	}

	async getFilmstrip(
		media: MediaMetadata,
		priorityRange?: FrameRange,
		onProgress?: (progress: number) => void,
		allowExtraction = true
	): Promise<Filmstrip> {
		this.clearIdleTimer(media.id);

		const totalFrames = Math.max(1, Math.ceil(media.duration * FILMSTRIP_FRAME_RATE));
		const targetIndices = buildTargetIndices(totalFrames, priorityRange ?? null);

		const loading = this.loadingPromises.get(media.id);
		if (loading) return loading;

		const cached = this.cachedFilmstrip(media.id);
		if (cached?.isComplete && !this.missingTargets(cached, targetIndices)) {
			return cached;
		}

		const version = this.cacheVersions.get(media.id) ?? 0;
		const promise = this.loadPersistedOrExtract(
			media,
			targetIndices,
			onProgress,
			allowExtraction,
			version
		);
		this.loadingPromises.set(media.id, promise);
		try {
			return await promise;
		} finally {
			const current = this.loadingPromises.get(media.id);
			if (current === promise) this.loadingPromises.delete(media.id);
		}
	}

	private async loadPersistedOrExtract(
		media: MediaMetadata,
		targetIndices: number[],
		onProgress: ((progress: number) => void) | undefined,
		allowExtraction: boolean,
		version: number
	): Promise<Filmstrip> {
		const persisted = await loadFilmstrip(media.id);
		if (!this.cacheIsCurrent(media.id, version)) return emptyFilmstrip();
		if (persisted.length > 0) {
			const filmstrip: Filmstrip = {
				frames: persisted,
				isComplete: true,
				isExtracting: false,
				progress: 100
			};
			this.storeAndNotify(media.id, filmstrip, true);
			if (!this.missingTargets(filmstrip, targetIndices)) return filmstrip;
			if (!allowExtraction) return filmstrip;
		}
		if (!allowExtraction) return emptyFilmstrip();
		return this.loadAndExtract(media, targetIndices, onProgress, version);
	}

	/** Clear one media item's derived filmstrip without deleting source media. */
	async clearMedia(mediaId: string): Promise<void> {
		this.cacheVersions.set(mediaId, (this.cacheVersions.get(mediaId) ?? 0) + 1);
		this.dropEntry(mediaId);
		this.notifyThrottled(mediaId, emptyFilmstrip(), true);
		await this.pendingPersistence.get(mediaId)?.catch(() => undefined);
		await removeOpfsEntry('filmstrips', mediaId);
	}

	clearAll(): void {
		for (const mediaId of this.cache.keys()) {
			this.dropEntry(mediaId);
		}
		this.cache.clear();
		for (const mediaId of [...this.idleTimers.keys()]) {
			this.clearIdleTimer(mediaId);
		}
		this.pendingExtractions.clear();
		this.loadingPromises.clear();
		this.extractionQueue = [];
		this.activeExtractions.clear();
		this.lastNotifyAt.clear();
		this.workerPool.terminateAll();
		this.prewarmStarted = false;
	}

	__resetForTesting(): void {
		this.clearAll();
	}

	// ── internals ───────────────────────────────────────────────────────────

	private missingTargets(filmstrip: Filmstrip, targetIndices: number[]): boolean {
		const available = new Set(filmstrip.frames.map((frame) => frame.index));
		return targetIndices.some((index) => !available.has(index));
	}

	private async loadAndExtract(
		media: MediaMetadata,
		targetIndices: number[],
		onProgress: ((progress: number) => void) | undefined,
		version: number
	): Promise<Filmstrip> {
		const cached = this.cachedFilmstrip(media.id);
		const frames = new Map<number, string | null>();
		const bitmaps = new Map<number, ImageBitmap>();
		for (const frame of cached?.frames ?? []) {
			frames.set(frame.index, frame.url);
			if (frame.bitmap) bitmaps.set(frame.index, frame.bitmap);
		}

		const initial: Filmstrip = {
			frames: sortFrames(frames, bitmaps),
			isComplete: false,
			isExtracting: true,
			progress: cached?.progress ?? 0
		};
		this.storeAndNotify(media.id, initial, true);

		const blob = await resolveMediaBlobForFilmstrip(media);

		return new Promise<Filmstrip>((resolve, reject) => {
			const requestId = `extract-${++this.requestSeq}`;
			this.pendingExtractions.set(media.id, { requestId, targetIndices, frames });
			this.pendingQueueStarts.set(media.id, () => {
				void this.runExtraction(
					media,
					blob,
					requestId,
					targetIndices,
					frames,
					bitmaps,
					onProgress,
					version,
					resolve,
					reject
				);
			});
			this.enqueueExtraction(media.id);
		});
	}

	private enqueueExtraction(mediaId: string): void {
		if (this.activeExtractions.has(mediaId)) return;
		if (this.activeExtractions.size >= getMaxConcurrentExtractions()) {
			this.extractionQueue.push(mediaId);
			this.extractionQueue.sort((a, b) => this.getQueueScore(a) - this.getQueueScore(b));
			return;
		}
		const start = this.pendingQueueStarts.get(mediaId);
		if (!start) return;
		this.pendingQueueStarts.delete(mediaId);
		this.activeExtractions.add(mediaId);
		start();
	}

	private pumpQueue(): void {
		if (this.activeExtractions.size >= getMaxConcurrentExtractions()) return;
		while (this.extractionQueue.length > 0) {
			const nextMediaId = this.extractionQueue.shift();
			if (!nextMediaId) return;
			const pending = this.pendingExtractions.get(nextMediaId);
			const loading = this.pendingQueueStarts.get(nextMediaId);
			if (!pending || !loading) continue;
			this.activeExtractions.add(nextMediaId);
			loading();
			this.pendingQueueStarts.delete(nextMediaId);
			return;
		}
	}

	private getQueueScore(mediaId: string): number {
		const pending = this.pendingExtractions.get(mediaId);
		if (!pending) return Number.POSITIVE_INFINITY;
		return pending.targetIndices.length - pending.frames.size;
	}

	private async runExtraction(
		media: MediaMetadata,
		blob: Blob,
		requestId: string,
		targetIndices: number[],
		frames: Map<number, string | null>,
		bitmaps: Map<number, ImageBitmap>,
		onProgress: ((progress: number) => void) | undefined,
		version: number,
		resolve: (filmstrip: Filmstrip) => void,
		reject: (error: Error) => void
	): Promise<void> {
		const worker = this.workerPool.acquireWorker();

		const cleanup = () => {
			worker.removeEventListener('message', onMessage);
			worker.removeEventListener('error', onError);
			this.pendingExtractions.delete(media.id);
			this.activeExtractions.delete(media.id);
			this.pendingQueueStarts.delete(media.id);
			this.workerPool.releaseWorker(worker, { maxIdleWorkers: MAX_IDLE_WORKERS });
			this.pumpQueue();
		};

		const onMessage = (event: MessageEvent<FilmstripWorkerResponse>) => {
			const message = event.data;
			if (message.requestId !== requestId) return;
			const current = this.cacheIsCurrent(media.id, version);

			if (message.type === 'progress') {
				if (!current) return;
				for (const saved of message.savedFrames) {
					pendingFrameUrlRevoker(this.cache.get(media.id)?.filmstrip, saved.index);
					frames.set(saved.index, URL.createObjectURL(saved.blob));
					void this.queuePersistence(media.id, () =>
						saveFilmstripFrame(media.id, saved.index, saved.blob)
					);
					void createImageBitmap(saved.blob)
						.then((bitmap) => {
							if (!this.cacheIsCurrent(media.id, version)) {
								bitmap.close();
								return;
							}
							bitmaps.get(saved.index)?.close();
							bitmaps.set(saved.index, bitmap);
							const current = this.cachedFilmstrip(media.id);
							if (!current) return;
							const next = { ...current, frames: sortFrames(frames, bitmaps) };
							this.storeEntry(media.id, next);
							this.notifyThrottled(media.id, next);
						})
						.catch(() => undefined);
				}
				onProgress?.(message.progress);
				const filmstrip: Filmstrip = {
					frames: sortFrames(frames, bitmaps),
					isComplete: false,
					isExtracting: true,
					progress: message.progress
				};
				this.notifyThrottled(media.id, filmstrip);
				this.enforceMemoryBudget();
				return;
			}

			if (message.type === 'complete') {
				cleanup();
				if (!current) {
					resolve(emptyFilmstrip());
					return;
				}
				for (const index of message.unavailableIndices ?? []) {
					frames.delete(index);
				}
				const filmstrip: Filmstrip = {
					frames: sortFrames(frames, bitmaps),
					isComplete: true,
					isExtracting: false,
					progress: 100
				};
				this.storeEntry(media.id, filmstrip);
				void this.queuePersistence(media.id, () =>
					saveFilmstripIndex(
						media.id,
						filmstrip.frames.map((frame) => frame.index)
					)
				);
				this.notifyThrottled(media.id, filmstrip, true);
				this.enforceMemoryBudget();
				resolve(filmstrip);
				return;
			}

			if (message.type === 'error') {
				cleanup();
				reject(new Error(message.error));
			}
		};

		const onError = (event: ErrorEvent) => {
			cleanup();
			reject(new Error(event.message));
		};

		worker.addEventListener('message', onMessage);
		worker.addEventListener('error', onError);

		const request: FilmstripExtractRequest = {
			type: 'extract',
			requestId,
			blob,
			durationSeconds: media.duration,
			targetIndices
		};
		worker.postMessage(request);
	}

	private storeAndNotify(mediaId: string, filmstrip: Filmstrip, force: boolean): void {
		this.storeEntry(mediaId, filmstrip);
		this.notifyThrottled(mediaId, filmstrip, force);
		this.enforceMemoryBudget();
	}

	private cacheIsCurrent(mediaId: string, version: number): boolean {
		return (this.cacheVersions.get(mediaId) ?? 0) === version;
	}

	private queuePersistence(mediaId: string, write: () => Promise<void>): Promise<void> {
		const pending = this.pendingPersistence.get(mediaId) ?? Promise.resolve();
		const next = pending
			.catch(() => undefined)
			.then(write)
			.catch(() => undefined);
		this.pendingPersistence.set(mediaId, next);
		void next.then(() => {
			if (this.pendingPersistence.get(mediaId) === next) this.pendingPersistence.delete(mediaId);
		});
		return next;
	}

	private storeEntry(mediaId: string, filmstrip: Filmstrip): void {
		const previous = this.cache.get(mediaId);
		if (previous) {
			closeReplacedFrames(previous.filmstrip, filmstrip);
		}
		this.cache.add(mediaId, {
			sizeBytes: estimatedFilmstripBytes(filmstrip),
			lastAccessed: Date.now(),
			filmstrip
		});
	}

	private notifyThrottled(mediaId: string, filmstrip: Filmstrip, force = false): void {
		const now = Date.now();
		const last = this.lastNotifyAt.get(mediaId) ?? 0;
		if (!force && now - last < PROGRESS_NOTIFY_INTERVAL_MS) return;
		this.lastNotifyAt.set(mediaId, now);

		const callbacks = this.updateCallbacks.get(mediaId);
		if (callbacks) {
			for (const callback of callbacks) callback(filmstrip);
		}
	}

	private dropEntry(mediaId: string): void {
		const entry = this.cache.get(mediaId);
		if (entry) {
			revokeFrames(entry.filmstrip);
		}
		this.cache.delete(mediaId);
	}

	private enforceMemoryBudget(force = false): void {
		const now = Date.now();
		if (!force && now - this.lastMemoryCheckAt < 500) return;
		this.lastMemoryCheckAt = now;

		while (this.cache.sizeBytes > MEMORY_SOFT_LIMIT_BYTES && this.cache.keys().length > 0) {
			const evictable = this.cache
				.keys()
				.filter(
					(mediaId) => !this.hasSubscribers(mediaId) && !this.pendingExtractions.has(mediaId)
				);
			if (evictable.length === 0) break;
			// Drop the oldest-accessed evictable entry; SizedAccessedMemoryCache
			// would pick strictly-oldest overall but subscribers must survive.
			let oldestId: string | null = null;
			let oldestTime = Number.POSITIVE_INFINITY;
			for (const mediaId of evictable) {
				const accessed = this.cache.get(mediaId)?.lastAccessed ?? 0;
				if (accessed < oldestTime) {
					oldestTime = accessed;
					oldestId = mediaId;
				}
			}
			if (!oldestId) break;
			this.dropEntry(oldestId);
		}
	}

	private hasSubscribers(mediaId: string): boolean {
		const callbacks = this.updateCallbacks.get(mediaId);
		return !!callbacks && callbacks.size > 0;
	}

	private scheduleIdleEviction(mediaId: string): void {
		this.clearIdleTimer(mediaId);
		if (this.pendingExtractions.has(mediaId)) return;
		if (!this.cache.get(mediaId)) return;
		this.idleTimers.set(
			mediaId,
			setTimeout(() => {
				this.idleTimers.delete(mediaId);
				if (this.hasSubscribers(mediaId) || this.pendingExtractions.has(mediaId)) return;
				this.dropEntry(mediaId);
			}, CACHE_EVICT_IDLE_MS)
		);
	}

	private clearIdleTimer(mediaId: string): void {
		const timer = this.idleTimers.get(mediaId);
		if (timer) {
			clearTimeout(timer);
			this.idleTimers.delete(mediaId);
		}
	}
}

function emptyFilmstrip(): Filmstrip {
	return { frames: [], isComplete: false, isExtracting: false, progress: 0 };
}

async function resolveMediaBlobForFilmstrip(media: MediaMetadata): Promise<Blob> {
	const { resolveMediaBlob } = await import('./import.svelte');
	return resolveMediaBlob(media);
}

function sortFrames(
	frames: Map<number, string | null>,
	bitmaps: Map<number, ImageBitmap> = new Map()
): FilmstripFrame[] {
	return [...frames.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([index, url]) => ({ index, url, bitmap: bitmaps.get(index) }));
}

function closeReplacedFrames(previous: Filmstrip, next: Filmstrip): void {
	const retained = new Set(next.frames.map((frame) => frame.url));
	for (const frame of previous.frames) {
		if (frame.url && !retained.has(frame.url)) URL.revokeObjectURL(frame.url);
		if (frame.bitmap && !next.frames.some((candidate) => candidate.bitmap === frame.bitmap))
			frame.bitmap.close();
	}
}

function pendingFrameUrlRevoker(previous: Filmstrip | undefined, index: number): void {
	if (!previous) return;
	const frame = previous.frames.find((candidate) => candidate.index === index);
	if (frame?.url) URL.revokeObjectURL(frame.url);
	frame?.bitmap?.close();
}

function revokeFrames(filmstrip: Filmstrip): void {
	for (const frame of filmstrip.frames) {
		if (frame.url) URL.revokeObjectURL(frame.url);
		frame.bitmap?.close();
	}
}

export const filmstripCache = new FilmstripCacheService();
