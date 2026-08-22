/**
 * Ported from FreeCut (MIT) — timeline/workers/filmstrip-extraction-worker.ts.
 *
 * Extracts filmstrip frames at 1 source frame per second using mediabunny's
 * CanvasSink. All heavy decode and JPEG encode work happens in the worker;
 * the main thread turns the returned JPEG blobs into object URLs for <img>
 * tiles. Trimmed versus FreeCut: Blob-based input (no blobUrl/sourceMetadata
 * indirection), no ProRes live-decode registration, no per-worker range
 * chunking (concurrency happens across media ids instead), and no ImageBitmap
 * fast path (tiles render as <img> from the persisted-quality JPEGs).
 */

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { FILMSTRIP_EXTRACT_HEIGHT, FILMSTRIP_FRAME_RATE } from './filmstrip-plan';

const IMAGE_FORMAT = 'image/jpeg';
const IMAGE_QUALITY = 0.7;

export interface FilmstripExtractRequest {
	type: 'extract';
	requestId: string;
	blob: Blob;
	durationSeconds: number;
	targetIndices: number[];
}

export interface FilmstripAbortRequest {
	type: 'abort';
	requestId: string;
}

export interface FilmstripWarmRequest {
	type: 'warm';
	requestId: string;
}

export interface FilmstripProgressResponse {
	type: 'progress';
	requestId: string;
	savedFrames: Array<{ index: number; blob: Blob }>;
	progress: number;
}

export interface FilmstripCompleteResponse {
	type: 'complete';
	requestId: string;
	frameCount: number;
	unavailableIndices: number[];
}

export interface FilmstripErrorResponse {
	type: 'error';
	requestId: string;
	error: string;
}

export interface FilmstripWarmedResponse {
	type: 'warmed';
	requestId: string;
}

export type FilmstripWorkerResponse =
	| FilmstripProgressResponse
	| FilmstripCompleteResponse
	| FilmstripErrorResponse
	| FilmstripWarmedResponse;

type WorkerRequest = FilmstripExtractRequest | FilmstripAbortRequest | FilmstripWarmRequest;

const activeRequests = new Map<string, { aborted: boolean }>();

async function extractAndSave(
	request: FilmstripExtractRequest,
	state: { aborted: boolean }
): Promise<void> {
	const { requestId, blob, durationSeconds, targetIndices } = request;

	const totalFrames = Math.max(1, Math.ceil(durationSeconds * FILMSTRIP_FRAME_RATE));
	const requested = [...targetIndices].sort((a, b) => a - b);
	const framesToExtract = requested
		.filter((index) => index >= 0 && index < totalFrames)
		.map((index) => ({ index, timestamp: index / FILMSTRIP_FRAME_RATE }));

	const completedWithoutWork =
		requested.reduce((count, index) => (index >= 0 && index < totalFrames ? count + 1 : count), 0) -
		framesToExtract.length;

	if (framesToExtract.length === 0) {
		self.postMessage({
			type: 'complete',
			requestId,
			frameCount: completedWithoutWork,
			unavailableIndices: []
		} satisfies FilmstripCompleteResponse);
		return;
	}

	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	let sink: CanvasSink | null = null;

	try {
		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) throw new Error('No video track found');

		const [squarePixelWidth, squarePixelHeight, rotation] = await Promise.all([
			videoTrack.getSquarePixelWidth(),
			videoTrack.getSquarePixelHeight(),
			videoTrack.getRotation()
		]);
		const quarterTurns = Math.round(rotation / 90) % 2;
		const displayWidth = quarterTurns === 0 ? squarePixelWidth : squarePixelHeight;
		const displayHeight = quarterTurns === 0 ? squarePixelHeight : squarePixelWidth;
		const scale = Math.min(1, FILMSTRIP_EXTRACT_HEIGHT / Math.max(1, displayHeight));

		sink = new CanvasSink(videoTrack, {
			width: Math.max(2, Math.round(displayWidth * scale)),
			height: Math.max(2, Math.round(displayHeight * scale)),
			fit: 'fill',
			poolSize: 4
		});

		async function* timestampGenerator(): AsyncGenerator<number> {
			for (const frame of framesToExtract) {
				if (state.aborted) return;
				yield frame.timestamp;
			}
		}

		const canvasIterable = sink.canvasesAtTimestamps(timestampGenerator());

		let savedSinceLastReport: Array<{ index: number; blob: Blob }> = [];
		let extractedCount = completedWithoutWork;
		let frameListIndex = 0;
		const unavailableIndices: number[] = [];

		for await (const wrapped of canvasIterable) {
			if (state.aborted) break;

			const frame = framesToExtract[frameListIndex];
			if (!frame) break;

			frameListIndex++;
			if (!wrapped) {
				unavailableIndices.push(frame.index);
				continue;
			}

			const frameBlob = await new Promise<Blob | null>((resolve) => {
				if (wrapped.canvas instanceof OffscreenCanvas) {
					void wrapped.canvas.convertToBlob({ type: IMAGE_FORMAT, quality: IMAGE_QUALITY }).then(
						(b) => resolve(b),
						() => resolve(null)
					);
				} else {
					// SAFETY: this branch is the HTMLCanvasElement half of the union.
					(wrapped.canvas as HTMLCanvasElement).toBlob(resolve, IMAGE_FORMAT, IMAGE_QUALITY);
				}
			});
			if (!frameBlob) {
				unavailableIndices.push(frame.index);
				continue;
			}

			extractedCount++;
			savedSinceLastReport.push({ index: frame.index, blob: frameBlob });

			const shouldReport =
				extractedCount <= 3 || extractedCount % 10 === 0 || savedSinceLastReport.length >= 8;
			if (shouldReport) {
				const progress = Math.min(99, Math.round((extractedCount / totalFrames) * 100));
				self.postMessage({
					type: 'progress',
					requestId,
					savedFrames: savedSinceLastReport,
					progress
				} satisfies FilmstripProgressResponse);
				savedSinceLastReport = [];
			}
		}

		if (savedSinceLastReport.length > 0 && !state.aborted) {
			self.postMessage({
				type: 'progress',
				requestId,
				savedFrames: savedSinceLastReport,
				progress: 99
			} satisfies FilmstripProgressResponse);
			savedSinceLastReport = [];
		}

		if (!state.aborted) {
			self.postMessage({
				type: 'complete',
				requestId,
				frameCount: extractedCount,
				unavailableIndices
			} satisfies FilmstripCompleteResponse);
		}
	} finally {
		input.dispose();
	}
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
	const { type } = event.data;

	try {
		switch (type) {
			case 'extract': {
				const request = event.data;
				const state = { aborted: false };
				activeRequests.set(request.requestId, state);
				try {
					await extractAndSave(request, state);
				} finally {
					activeRequests.delete(request.requestId);
				}
				break;
			}
			case 'abort': {
				const state = activeRequests.get(event.data.requestId);
				if (state) state.aborted = true;
				break;
			}
			case 'warm': {
				// Loading mediabunny happens via the static import above; warm exists
				// so the client can pre-boot a worker before the first extraction.
				self.postMessage({
					type: 'warmed',
					requestId: event.data.requestId
				} satisfies FilmstripWarmedResponse);
				break;
			}
		}
	} catch (error) {
		self.postMessage({
			type: 'error',
			requestId: event.data.requestId,
			error: error instanceof Error ? error.message : String(error)
		} satisfies FilmstripErrorResponse);
	}
};

export {};
