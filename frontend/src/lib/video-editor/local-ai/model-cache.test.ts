import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	LOCAL_MODEL_CACHE_DEFINITIONS,
	clearLocalModelCache,
	inspectLocalModelCache
} from './model-cache';

function createCacheStorage(entries: Array<{ url: string; bytes?: number }>): CacheStorage {
	const responses = new Map(
		entries.map((entry) => [
			entry.url,
			new Response(new Uint8Array(entry.bytes ?? 0), {
				headers: entry.bytes == null ? {} : { 'content-length': String(entry.bytes) }
			})
		])
	);
	const cache = {
		keys: vi.fn(async () => Array.from(responses.keys(), (url) => new Request(url))),
		match: vi.fn(async (request: RequestInfo) =>
			responses.get(typeof request === 'string' ? request : request.url)?.clone()
		),
		delete: vi.fn(async (request: RequestInfo) =>
			responses.delete(typeof request === 'string' ? request : request.url)
		)
	} as unknown as Cache;
	return {
		keys: vi.fn(async () => ['transformers-cache', 'openpost-onnx-models-v1']),
		open: vi.fn(async () => cache)
	} as unknown as CacheStorage;
}

const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');

function setCaches(storage: CacheStorage): void {
	Object.defineProperty(globalThis, 'caches', { configurable: true, value: storage });
}

afterEach(() => {
	if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
	else Reflect.deleteProperty(globalThis, 'caches');
});

describe('local model cache', () => {
	it('reports only the entries that belong to one model', async () => {
		setCaches(
			createCacheStorage([
				{
					url: 'https://huggingface.co/onnx-community/whisper-base/resolve/main/a.onnx',
					bytes: 40
				},
				{ url: 'https://huggingface.co/LiquidAI/LFM2.5-VL-450M-ONNX/a.onnx', bytes: 90 }
			])
		);
		const whisper = LOCAL_MODEL_CACHE_DEFINITIONS.find((entry) => entry.id === 'whisper')!;
		await expect(inspectLocalModelCache(whisper)).resolves.toMatchObject({
			downloaded: true,
			entryCount: 1,
			totalBytes: 40,
			sizeStatus: 'exact'
		});
	});

	it('does not claim an absent model is downloaded', async () => {
		setCaches(createCacheStorage([]));
		const parakeet = LOCAL_MODEL_CACHE_DEFINITIONS.find((entry) => entry.id === 'parakeet')!;
		await expect(inspectLocalModelCache(parakeet)).resolves.toMatchObject({
			downloaded: false,
			entryCount: 0
		});
	});

	it('clears matching model entries without deleting other models', async () => {
		const storage = createCacheStorage([
			{ url: 'https://huggingface.co/onnx-community/whisper-base/resolve/main/a.onnx', bytes: 40 },
			{ url: 'https://huggingface.co/LiquidAI/LFM2.5-VL-450M-ONNX/a.onnx', bytes: 90 }
		]);
		setCaches(storage);
		const whisper = LOCAL_MODEL_CACHE_DEFINITIONS.find((entry) => entry.id === 'whisper')!;
		await expect(clearLocalModelCache(whisper)).resolves.toBe(true);
		const cache = await storage.open('transformers-cache');
		expect((await cache.keys()).map((request) => request.url)).toEqual([
			'https://huggingface.co/LiquidAI/LFM2.5-VL-450M-ONNX/a.onnx'
		]);
	});
});
