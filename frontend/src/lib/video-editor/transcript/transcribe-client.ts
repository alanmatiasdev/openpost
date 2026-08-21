/**
 * Client wrapper for the Whisper transcription worker: lazily spawns the
 * worker, streams chunk progress, and resolves with merged word timings.
 */

import type { TranscriptWord } from './cues';
import { mergeChunkWords } from './words';
import { WHISPER_SAMPLE_RATE, planChunks } from './chunker';
import type { WhisperWorkerChunkMessage, WhisperWorkerResponse } from './whisper-worker';

export interface TranscribeOptions {
	modelId?: string;
	windowSeconds?: number;
	overlapSeconds?: number;
	onProgress?: (progress: number) => void;
}

export const DEFAULT_WHISPER_MODEL_ID = 'onnx-community/whisper-base';

let worker: Worker | null = null;

function getWorker(): Worker {
	if (!worker) {
		worker = new Worker(new URL('./whisper-worker.ts', import.meta.url), { type: 'module' });
	}
	return worker;
}

export function transcribeAudio(
	buffer: Float32Array,
	sampleRate: number,
	durationSeconds: number,
	options: TranscribeOptions = {}
): Promise<TranscriptWord[]> {
	const overlap = options.overlapSeconds ?? 2;
	const chunks = planChunks(durationSeconds, options.windowSeconds, overlap);
	const target = (sampleRate / WHISPER_SAMPLE_RATE) * durationSeconds;
	const stitched = new Promise<TranscriptWord[]>((resolve, reject) => {
		const port = getWorker();
		let accumulated: TranscriptWord[] = [];
		port.onmessage = (event: MessageEvent<WhisperWorkerResponse>) => {
			const message = event.data;
			if (message.type === 'chunk') {
				options.onProgress?.(message.progress);
				accumulated = mergeChunkWords(accumulated, message.words, overlap);
				return;
			}
			if (message.type === 'done') {
				port.onmessage = null;
				if (message.error) {
					reject(new Error(message.error));
					return;
				}
				resolve(mergeChunkWords(accumulated, message.words, overlap));
			}
		};
		port.onerror = (event) => reject(new Error(event.message));
		port.postMessage({
			buffer: resampleTo16k(buffer, sampleRate, target),
			chunks,
			modelId: options.modelId ?? DEFAULT_WHISPER_MODEL_ID
		});
	});
	return stitched;
}

/** Naive linear resample; ASR tolerates it and avoids pulling in a DSP dep. */
function resampleTo16k(
	buffer: Float32Array,
	sampleRate: number,
	targetLengthSamples: number
): Float32Array {
	if (sampleRate === WHISPER_SAMPLE_RATE) return buffer;
	if (!(targetLengthSamples > 0)) return new Float32Array(0);
	const output = new Float32Array(Math.floor(targetLengthSamples));
	const ratio = buffer.length / output.length;
	for (let i = 0; i < output.length; i++) {
		const sourceIndex = Math.min(buffer.length - 1, Math.floor(i * ratio));
		output[i] = buffer[sourceIndex]!;
	}
	return output;
}

export { mergeChunkWords };
