import { afterEach, describe, expect, it } from 'vitest';
import {
	LOCAL_MODEL_CACHE_DEFINITIONS,
	clearLocalModelCache,
	inspectLocalModelCache
} from './model-cache';

function requestUrl(request: RequestInfo | URL): string {
	return request instanceof Request ? request.url : String(request);
}

class MemoryCache implements Cache {
	constructor(private readonly responses: Map<string, Response>) {}

	async add(): Promise<void> {}
	async addAll(): Promise<void> {}
	async put(request: RequestInfo | URL, response: Response): Promise<void> {
		this.responses.set(requestUrl(request), response);
	}
	async match(request: RequestInfo | URL): Promise<Response | undefined> {
		return this.responses.get(requestUrl(request))?.clone();
	}
	async matchAll(request?: RequestInfo | URL): Promise<Response[]> {
		if (request !== undefined) {
			const response = await this.match(request);
			return response ? [response] : [];
		}
		return Array.from(this.responses.values(), (response) => response.clone());
	}
	async delete(request: RequestInfo | URL): Promise<boolean> {
		return this.responses.delete(requestUrl(request));
	}
	async keys(): Promise<Request[]> {
		return Array.from(this.responses.keys(), (url) => new Request(url));
	}
}

class MemoryCacheStorage implements CacheStorage {
	constructor(private readonly cache: Cache) {}

	async delete(): Promise<boolean> {
		return false;
	}
	async has(): Promise<boolean> {
		return true;
	}
	async match(request: RequestInfo | URL): Promise<Response | undefined> {
		return this.cache.match(request);
	}
	async keys(): Promise<string[]> {
		return ['transformers-cache', 'openpost-onnx-models-v1'];
	}
	async open(): Promise<Cache> {
		return this.cache;
	}
}

function createCacheStorage(entries: Array<{ url: string; bytes?: number }>): CacheStorage {
	const responses = new Map(
		entries.map((entry) => [
			entry.url,
			new Response(new Uint8Array(entry.bytes ?? 0), {
				headers: entry.bytes == null ? {} : { 'content-length': String(entry.bytes) }
			})
		])
	);
	return new MemoryCacheStorage(new MemoryCache(responses));
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
