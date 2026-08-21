/**
 * Ported from FreeCut (MIT) — media-library/transcription/workers/
 * whisper.worker.ts, trimmed to a chunked automatic-speech-recognition
 * pipeline that reports word-level timings per window.
 */

import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { TranscriptWord } from './cues';
import { WHISPER_SAMPLE_RATE, type ChunkPlan } from './chunker';

export interface WhisperWorkerRequest {
	buffer: Float32Array;
	chunks: ChunkPlan[];
	modelId: string;
}

export interface WhisperWorkerChunkMessage {
	type: 'chunk';
	words: TranscriptWord[];
	progress: number;
}

export interface WhisperWorkerDoneMessage {
	type: 'done';
	words: TranscriptWord[];
	error?: string;
}

export interface WhisperWorkerChunksCompleteMessage {
	type: 'chunks-complete';
}

export type WhisperWorkerResponse =
	| WhisperWorkerChunkMessage
	| WhisperWorkerDoneMessage
	| WhisperWorkerChunksCompleteMessage;

let asrPipeline: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let loadedModelId = '';

async function getPipeline(modelId: string): Promise<AutomaticSpeechRecognitionPipeline> {
	if (asrPipeline && loadedModelId === modelId) return asrPipeline;
	// SAFETY: narrowing to the ASR factory signature keeps the huge overload union out of the AST.
	const asrFactory = pipeline as (
		task: 'automatic-speech-recognition',
		modelId: string,
		options?: Record<string, never>
	) => Promise<unknown>;
	// SAFETY: transformers.js resolves its ASR pipeline for this task key.
	const created = (await asrFactory(
		'automatic-speech-recognition',
		modelId,
		{}
	)) as AutomaticSpeechRecognitionPipeline;
	asrPipeline = Promise.resolve(created);
	loadedModelId = modelId;
	return asrPipeline;
}

interface AsrChunkOutput {
	text?: string;
	chunks?: Array<{ text?: string; timestamp?: [number | null, number | null] }>;
}

function wordsFromChunk(
	output: AsrChunkOutput,
	offsetSeconds: number,
	fallbackEnd: number
): TranscriptWord[] {
	const pieces = output.chunks ?? [];
	const words: TranscriptWord[] = [];
	for (const piece of pieces) {
		const text = piece.text?.trim();
		if (!text) continue;
		const startSeconds = (piece.timestamp?.[0] ?? 0) + offsetSeconds;
		const endSeconds = Math.min((piece.timestamp?.[1] ?? fallbackEnd) + offsetSeconds, fallbackEnd);
		if (!(endSeconds > startSeconds)) continue;
		words.push({ text, startSeconds, endSeconds });
	}
	return words;
}

self.onmessage = async (event: MessageEvent<WhisperWorkerRequest>): Promise<void> => {
	const { buffer, chunks, modelId } = event.data;
	try {
		const recognizer = await getPipeline(modelId);
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i]!;
			const sampleStart = Math.floor(chunk.startSeconds * WHISPER_SAMPLE_RATE);
			const sampleEnd = Math.min(Math.ceil(chunk.endSeconds * WHISPER_SAMPLE_RATE), buffer.length);
			const slice = buffer.slice(sampleStart, sampleEnd);
			// SAFETY: ASR output shape is documented as {text, chunks:[{timestamp}]} for word timestamps.
			const output = (await recognizer(slice, {
				return_timestamps: 'word',
				chunk_length_s: chunk.endSeconds - chunk.startSeconds
			})) as AsrChunkOutput;
			// Timestamps come back relative to the sliced window; shift to media time.
			const words = wordsFromChunk(output, chunk.startSeconds, chunk.endSeconds);
			const message: WhisperWorkerResponse = {
				type: 'chunk',
				words,
				progress: (i + 1) / chunks.length
			};
			self.postMessage(message);
		}
		self.postMessage({ type: 'chunks-complete' } satisfies WhisperWorkerChunksCompleteMessage);
	} catch (error) {
		const failure: WhisperWorkerDoneMessage = {
			type: 'done',
			words: [],
			error: error instanceof Error ? error.message : String(error)
		};
		self.postMessage(failure);
	}
};
