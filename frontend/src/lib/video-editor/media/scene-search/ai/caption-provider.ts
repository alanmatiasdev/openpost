/** Singleton local scene-caption provider. Ported from FreeCut (MIT). */

import { createLogger } from '../../../workspace-fs/logger';
import type { SceneCaptionData } from '../types';
import { addAbortableWorkerMessageListener } from './worker-message-listener';

export const SCENE_CAPTION_MODEL_ID = 'LiquidAI/LFM2.5-VL-450M-ONNX';
const INIT_TIMEOUT_MS = 180_000;

export interface CaptionModelProgress {
	stage: 'loading-model' | 'captioning';
	percent: number;
	completed: number;
	total: number;
}

export interface CaptionedScene {
	text: string;
	sceneData?: SceneCaptionData;
}

interface CaptionOptions {
	signal?: AbortSignal;
	onProgress?: (progress: CaptionModelProgress) => void;
}

const logger = createLogger('SceneCaptionProvider');
let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
let nextId = 0;

function createWorker(): Worker {
	return new Worker(new URL('./lfm-scene-worker.ts', import.meta.url), { type: 'module' });
}

function getWorker(): Worker {
	if (!worker) {
		worker = createWorker();
		worker.addEventListener('error', (event) => {
			logger.error('Scene caption worker failed', event.message);
		});
	}
	return worker;
}

function resetWorker(): void {
	if (worker) {
		worker.postMessage({ type: 'dispose' });
		worker.terminate();
	}
	worker = null;
	readyPromise = null;
}

function ensureReady(options: CaptionOptions = {}): Promise<void> {
	if (readyPromise) return readyPromise;
	const activeWorker = getWorker();
	readyPromise = new Promise<void>((resolve, reject) => {
		let detach: () => void = () => undefined;
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error('Scene caption model timed out while loading'));
		}, INIT_TIMEOUT_MS);
		const cleanup = () => {
			clearTimeout(timeout);
			detach();
		};
		const onAbort = () => {
			cleanup();
			resetWorker();
			reject(options.signal?.reason ?? new DOMException('Captioning cancelled', 'AbortError'));
		};
		const onMessage = (event: MessageEvent) => {
			const message = event.data;
			if (message.type === 'ready') {
				cleanup();
				resolve();
			} else if (message.type === 'progress') {
				options.onProgress?.({
					stage: 'loading-model',
					percent: message.percent ?? 0,
					completed: 0,
					total: 0
				});
			} else if (message.type === 'error') {
				cleanup();
				reject(new Error(message.message ?? 'Scene caption model failed to load'));
			}
		};
		const listener = addAbortableWorkerMessageListener({
			worker: activeWorker,
			signal: options.signal,
			onAbort,
			onMessage
		});
		if (!listener) return;
		detach = listener;
		activeWorker.postMessage({ type: 'init' });
	});
	readyPromise.catch(() => {
		readyPromise = null;
	});
	return readyPromise;
}

function captionOne(
	image: Blob,
	index: number,
	total: number,
	options: CaptionOptions
): Promise<CaptionedScene> {
	const id = ++nextId;
	const activeWorker = getWorker();
	return new Promise<CaptionedScene>((resolve, reject) => {
		let detach: () => void = () => undefined;
		const cleanup = () => detach();
		const onAbort = () => {
			cleanup();
			resetWorker();
			reject(options.signal?.reason ?? new DOMException('Captioning cancelled', 'AbortError'));
		};
		const onMessage = (event: MessageEvent) => {
			const message = event.data;
			if (message.id !== id || message.type !== 'caption') return;
			cleanup();
			if (message.error && !message.caption) {
				reject(new Error(message.error));
				return;
			}
			options.onProgress?.({
				stage: 'captioning',
				percent: Math.round(((index + 1) / total) * 100),
				completed: index + 1,
				total
			});
			resolve({
				text: message.caption ?? '',
				sceneData: message.sceneData
			});
		};
		const listener = addAbortableWorkerMessageListener({
			worker: activeWorker,
			signal: options.signal,
			onAbort,
			onMessage
		});
		if (!listener) return;
		detach = listener;
		activeWorker.postMessage({ type: 'describe', id, image });
	});
}

export const sceneCaptionProvider = {
	ensureReady,
	async captionImages(images: Blob[], options: CaptionOptions = {}): Promise<CaptionedScene[]> {
		if (images.length === 0) return [];
		await ensureReady(options);
		const captions: CaptionedScene[] = [];
		for (let index = 0; index < images.length; index += 1) {
			if (options.signal?.aborted) {
				throw options.signal.reason ?? new DOMException('Captioning cancelled', 'AbortError');
			}
			captions.push(await captionOne(images[index]!, index, images.length, options));
		}
		return captions;
	},
	dispose: resetWorker
};
