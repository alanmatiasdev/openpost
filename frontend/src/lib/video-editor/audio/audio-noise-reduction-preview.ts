/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions -- worker message narrowing and transferables are owned. */
import type { ResolvedAudioNoiseReductionSettings } from './audio-noise-reduction';
import { applyNoiseReduction } from './audio-noise-reduction';

let worker: Worker | null = null;

function getWorker(): Worker | null {
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- worker availability probe
	if (typeof Worker === 'undefined') return null;
	if (worker) return worker;
	try {
		worker = new Worker(new URL('./audio-noise-reduction.worker.ts', import.meta.url), {
			type: 'module'
		});
		return worker;
	} catch {
		return null;
	}
}

export function disposeNoiseReductionPreviewWorker(): void {
	if (worker) {
		worker.terminate();
		worker = null;
	}
}

export async function processPreviewNoiseReduction(
	channels: Float32Array[],
	sampleRate: number,
	settings: ResolvedAudioNoiseReductionSettings,
	signal?: AbortSignal,
	onProgress?: (progress: number) => void
): Promise<Float32Array[]> {
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
	const w = getWorker();
	if (!w) {
		return applyNoiseReduction(channels, sampleRate, settings, signal);
	}

	const requestId = crypto.randomUUID();
	const channelBuffers = channels.map((ch) => {
		const copy = new Float32Array(ch);
		return copy.buffer as ArrayBuffer;
	});
	const channelLengths = channels.map((ch) => ch.length);

	return new Promise((resolve, reject) => {
		const handleAbort = (): void => {
			// SAFETY: abort payload matches worker's typed discriminant.
			w.postMessage({
				type: 'abort',
				requestId
			} satisfies import('./audio-noise-reduction.worker').NoiseReductionAbort);
			reject(new DOMException('Aborted', 'AbortError'));
		};
		signal?.addEventListener('abort', handleAbort, { once: true });

		const onMessage = (event: MessageEvent): void => {
			// SAFETY: messages are from the owned worker module; narrow by discriminant.
			const data = event.data as
				| import('./audio-noise-reduction.worker').NoiseReductionProgressResponse
				| import('./audio-noise-reduction.worker').NoiseReductionCompleteResponse
				| import('./audio-noise-reduction.worker').NoiseReductionErrorResponse;
			// oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- narrow to requestId for stale filtering
			if (!data || (data as { requestId?: string }).requestId !== requestId) return;
			if (data.type === 'progress') {
				onProgress?.(data.progress);
				return;
			}
			if (data.type === 'complete') {
				cleanup();
				const out = data.channelBuffers.map((ab, i) =>
					// oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- lengths are 1:1 with buffers by contract
					new Float32Array(ab).slice(0, data.channelLengths[i]!)
				);
				resolve(out);
				return;
			}
			if (data.type === 'error') {
				cleanup();
				reject(new Error(data.error));
			}
		};

		const onError = (e: ErrorEvent): void => {
			cleanup();
			reject(e.error ?? new Error(e.message));
		};

		function cleanup(): void {
			signal?.removeEventListener('abort', handleAbort);
			w.removeEventListener('message', onMessage);
			w.removeEventListener('error', onError);
		}

		w.addEventListener('message', onMessage);
		w.addEventListener('error', onError);
		// SAFETY: request payload matches worker's typed contract; buffers are transferred.
		w.postMessage(
			{
				type: 'process',
				requestId,
				sampleRate,
				amount: settings.amount,
				channelBuffers,
				channelLengths
			} satisfies import('./audio-noise-reduction.worker').NoiseReductionRequest,
			// oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- transfer list is typed by contract and owned
			{ transfer: channelBuffers } as unknown as StructuredSerializeOptions
		);
	});
}
