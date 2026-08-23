export const ONNX_MODEL_CACHE_NAME = 'openpost-onnx-models-v1';

type ProgressCallback = (received: number, total: number, fromCache: boolean) => void;

const inFlight = new Map<
	string,
	{ promise: Promise<ArrayBuffer>; listeners: Set<ProgressCallback> }
>();

async function openCache(): Promise<Cache | null> {
	if (!('caches' in globalThis)) return null;
	try {
		return await caches.open(ONNX_MODEL_CACHE_NAME);
	} catch {
		return null;
	}
}

async function readBytes(
	response: Response,
	onBytes: ProgressCallback,
	fromCache: boolean
): Promise<ArrayBuffer> {
	const total = Number(response.headers.get('content-length')) || 0;
	if (!response.body) return response.arrayBuffer();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		received += value.byteLength;
		onBytes(received, total, fromCache);
	}
	const merged = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return merged.buffer;
}

async function download(url: string, onBytes: ProgressCallback): Promise<ArrayBuffer> {
	const cache = await openCache();
	const cached = await cache?.match(url).catch(() => undefined);
	if (cached) return readBytes(cached, onBytes, true);
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Failed to fetch model asset (${response.status})`);
	const bytes = await readBytes(response, onBytes, false);
	await cache
		?.put(
			url,
			new Response(bytes, {
				headers: {
					'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
					'content-length': String(bytes.byteLength)
				}
			})
		)
		.catch(() => undefined);
	return bytes;
}

export function fetchOnnxModelBytes(url: string, onBytes?: ProgressCallback): Promise<ArrayBuffer> {
	const existing = inFlight.get(url);
	if (existing) {
		if (onBytes) existing.listeners.add(onBytes);
		return existing.promise;
	}
	const listeners = new Set<ProgressCallback>();
	if (onBytes) listeners.add(onBytes);
	const broadcast: ProgressCallback = (...args) => {
		for (const listener of listeners) listener(...args);
	};
	const promise = download(url, broadcast).finally(() => inFlight.delete(url));
	inFlight.set(url, { promise, listeners });
	return promise;
}

export async function fetchOnnxModelText(url: string): Promise<string> {
	const cache = await openCache();
	const cached = await cache?.match(url).catch(() => undefined);
	if (cached) return cached.text();
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Failed to fetch model asset (${response.status})`);
	await cache?.put(url, response.clone()).catch(() => undefined);
	return response.text();
}
