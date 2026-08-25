import { afterEach, describe, expect, it } from 'vitest';
import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	Input,
	Output,
	VideoSample,
	VideoSampleSink,
	VideoSampleSource,
	WebMOutputFormat
} from 'mediabunny';
import type { InterpolationWorkerResponse } from './frame-interpolation-worker';

const WIDTH = 64;
const HEIGHT = 36;
const FPS = 2;
const scratchJobs: string[] = [];

async function sourceVideo(): Promise<Blob> {
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const source = new VideoSampleSource({ codec: 'vp8', bitrate: 300_000, keyFrameInterval: 1 });
	output.addVideoTrack(source, { frameRate: FPS });
	await output.start();
	const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable.');
	for (let frame = 0; frame < 2; frame++) {
		context.fillStyle = frame === 0 ? '#e23b3b' : '#376ee6';
		context.fillRect(0, 0, WIDTH, HEIGHT);
		context.fillStyle = '#ffffff';
		context.fillRect(frame === 0 ? 6 : 42, 10, 16, 12);
		const sample = new VideoSample(canvas, {
			timestamp: frame / FPS,
			duration: 1 / FPS
		});
		await source.add(sample);
		sample.close();
	}
	source.close();
	await output.finalize();
	if (!target.buffer) throw new Error('Source render produced no bytes.');
	return new Blob([target.buffer], { type: 'video/webm' });
}

async function scratchFile(jobId: string): Promise<File> {
	const root = await navigator.storage.getDirectory();
	const dir = await root.getDirectoryHandle('interpolation-tmp');
	return (await dir.getFileHandle(`${jobId}.mp4`)).getFile();
}

afterEach(async () => {
	const root = await navigator.storage.getDirectory();
	const dir = await root.getDirectoryHandle('interpolation-tmp', { create: true });
	for (const jobId of scratchJobs.splice(0)) {
		await dir.removeEntry(`${jobId}.mp4`).catch(() => undefined);
	}
});

describe('RIFE frame interpolation worker', () => {
	it('runs the real model through download/cache, decode, inference, streamed encode, and decode', async () => {
		const worker = new Worker(new URL('./frame-interpolation-worker.ts', import.meta.url), {
			type: 'module'
		});
		const jobId = crypto.randomUUID();
		scratchJobs.push(jobId);
		try {
			const completion = new Promise<Extract<InterpolationWorkerResponse, { type: 'complete' }>>(
				(resolve, reject) => {
					const timeout = window.setTimeout(
						() => reject(new Error('Frame interpolation worker timed out.')),
						180_000
					);
					worker.onmessage = (event: MessageEvent<InterpolationWorkerResponse>) => {
						if (event.data.jobId !== jobId) return;
						if (event.data.type === 'complete') {
							window.clearTimeout(timeout);
							resolve(event.data);
						} else if (event.data.type === 'error') {
							window.clearTimeout(timeout);
							reject(new Error(event.data.error));
						}
					};
					worker.onerror = (event) => reject(new Error(event.message));
				}
			);
			worker.postMessage({
				type: 'interpolate',
				jobId,
				source: await sourceVideo(),
				sourceFps: FPS,
				factor: 2
			});

			const message = await completion;
			expect(message.result).toMatchObject({
				width: WIDTH,
				height: HEIGHT,
				sourceWidth: WIDTH,
				sourceHeight: HEIGHT,
				factor: 2,
				frameCount: 3
			});

			const rendered = await scratchFile(jobId);
			expect(rendered.size).toBeGreaterThan(500);
			const input = new Input({ source: new BlobSource(rendered), formats: ALL_FORMATS });
			try {
				const track = await input.getPrimaryVideoTrack();
				expect(track).not.toBeNull();
				let frames = 0;
				for await (const sample of new VideoSampleSink(track!).samples()) {
					frames++;
					sample.close();
				}
				expect(frames).toBe(3);
			} finally {
				input.dispose();
			}
		} finally {
			worker.terminate();
		}
	}, 200_000);
});
