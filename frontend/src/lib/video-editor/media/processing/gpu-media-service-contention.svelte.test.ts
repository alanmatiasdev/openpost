import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mediaTasks } from '../media-tasks.svelte';
import type { MediaMetadata } from '../types';
import {
	FrameInterpolationService,
	type FrameInterpolationServiceDependencies
} from './interpolation/frame-interpolation-service.svelte';
import { UpscaleService, type UpscaleServiceDependencies } from './upscale/upscale-service.svelte';
import type { InterpolationWorkerResponse } from './workers/frame-interpolation-worker';
import type { UpscaleWorkerResponse } from './workers/upscale-worker';

type WorkerResponse = InterpolationWorkerResponse | UpscaleWorkerResponse;

class FakeWorker extends EventTarget {
	onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent) => void) | null = null;
	requests: Array<{ type: string; jobId: string }> = [];

	postMessage(request: { type: string; jobId: string }): void {
		this.requests.push(request);
	}

	dispatch(response: WorkerResponse): void {
		this.onmessage?.(new MessageEvent('message', { data: response }));
	}

	terminate(): void {}
}

function media(id: string): MediaMetadata {
	return {
		id,
		storageType: 'workspace',
		fileName: `${id}.mp4`,
		fileSize: 100,
		mimeType: 'video/mp4',
		duration: 1,
		width: 64,
		height: 36,
		fps: 24,
		codec: 'avc',
		bitrate: 800,
		tags: ['video']
	};
}

function generated(id: string): MediaMetadata {
	return { ...media(id), width: 128, height: 72 };
}

beforeEach(() => mediaTasks.reset());
afterEach(() => mediaTasks.reset());

describe('GPU media service contention', () => {
	it('holds one shared GPU lease across upscale and interpolation', async () => {
		const upscaleWorker = new FakeWorker();
		const interpolationWorker = new FakeWorker();
		let interpolationWorkerRequested = false;
		const common = {
			resolveSource: async () => new Blob(['source']),
			rollbackImport: async () => undefined,
			readScratch: async () => new File([new Uint8Array([1])], 'result.mp4'),
			removeScratch: async () => undefined
		};
		const upscaleDependencies: UpscaleServiceDependencies = {
			...common,
			// SAFETY: FakeWorker implements every Worker member the service uses.
			createWorker: () => upscaleWorker as Worker,
			importVideo: async () => generated('upscaled')
		};
		const interpolationDependencies: FrameInterpolationServiceDependencies = {
			...common,
			createWorker: () => {
				interpolationWorkerRequested = true;
				// SAFETY: FakeWorker implements every Worker member the service uses.
				return interpolationWorker as Worker;
			},
			importVideo: async () => generated('interpolated')
		};
		const upscale = new UpscaleService(upscaleDependencies);
		const interpolation = new FrameInterpolationService(interpolationDependencies);
		const upscalePromise = upscale.generate(media('first'), 'project', 'liveAction');
		await expect.poll(() => upscaleWorker.requests.length).toBe(1);
		const upscaleRequest = upscaleWorker.requests[0]!;

		const interpolationPromise = interpolation.generate(media('second'), 'project', 2);
		await Promise.resolve();
		expect(interpolationWorkerRequested).toBe(false);

		upscaleWorker.dispatch({
			type: 'complete',
			jobId: upscaleRequest.jobId,
			opfsPath: `upscale-tmp/${upscaleRequest.jobId}.mp4`,
			result: {
				variant: 'liveAction',
				width: 128,
				height: 72,
				sourceWidth: 64,
				sourceHeight: 36,
				fps: 24,
				codec: 'avc',
				frameCount: 24
			}
		});
		await expect(upscalePromise).resolves.toMatchObject({ id: 'upscaled' });
		await expect.poll(() => interpolationWorker.requests.length).toBe(1);
		const interpolationRequest = interpolationWorker.requests[0]!;
		interpolationWorker.dispatch({
			type: 'complete',
			jobId: interpolationRequest.jobId,
			opfsPath: `interpolation-tmp/${interpolationRequest.jobId}.mp4`,
			result: {
				factor: 2,
				width: 64,
				height: 36,
				sourceWidth: 64,
				sourceHeight: 36,
				sourceFps: 24,
				outputFps: 48,
				codec: 'avc',
				frameCount: 48
			}
		});
		await expect(interpolationPromise).resolves.toMatchObject({ id: 'interpolated' });
	});
});
