import { describe, expect, it, vi } from 'vitest';
import type { AceStepGenerationResult, AceStepUpdateListener, AceStepWebGpu } from 'ai-music-js';
import {
	ACE_STEP_STANDARD_DOWNLOAD_BYTES,
	AceStepMusicService,
	musicGenerationTags,
	type AceStepRuntime
} from './ace-step-service';
import { gpuMediaJobScheduler } from '../../media/processing/gpu-media-job-scheduler';

function generationResult(seed: number): AceStepGenerationResult {
	const wav = new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'audio/wav' });
	// SAFETY: the service never reads audioBuffer in this wrapper test.
	const audioBuffer = {} as AudioBuffer;
	return {
		seed,
		audioQuality: 'standard',
		sampler: 'euler',
		instrumental: true,
		lyrics: '',
		audioBuffer,
		wav,
		wavBytes: new ArrayBuffer(4),
		channels: [new Float32Array(), new Float32Array()],
		sampleRate: 48_000,
		durationSeconds: 10,
		latentFrames: 250,
		trace: [],
		timings: {},
		estimatedPeakBytes: 1
	};
}

function fakeRuntime() {
	const listeners = new Set<AceStepUpdateListener>();
	const listCachedModels = vi.fn();
	const generate = vi.fn(async (options: Parameters<AceStepWebGpu['generate']>[0]) => {
		for (const listener of listeners) {
			listener({
				type: 'download',
				assetId: 'dit:weights:0',
				group: 'dit',
				label: 'ACE-Step DiT',
				loaded: 500,
				total: 1000,
				cached: false
			});
			listener({
				type: 'progress',
				operation: 'generate',
				stage: 'flow-matching',
				detail: 'DiT 4/8',
				progress: 0.5
			});
		}
		return generationResult(options.seed ?? 42);
	});
	const runtime: AceStepRuntime = {
		generate,
		subscribe: vi.fn((listener: AceStepUpdateListener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}),
		cancel: vi.fn(() => true),
		dispose: vi.fn(),
		listCachedModels,
		clearCache: vi.fn()
	};
	return { runtime, generate, listCachedModels };
}

describe('AceStepMusicService', () => {
	it('runs the qualified XL Turbo path and reports exact download and inference progress', async () => {
		const { runtime, generate } = fakeRuntime();
		const progress = vi.fn();
		const service = new AceStepMusicService(async () => runtime);
		const result = await service.generate({
			prompt: '  Warm cinematic pulse  ',
			durationSeconds: 10,
			audioQuality: 'standard',
			seed: 73,
			onProgress: progress
		});

		expect(generate).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: 'Warm cinematic pulse',
				durationSeconds: 10,
				audioQuality: 'standard',
				plannerQuality: 'turbo',
				sampler: 'euler',
				allowWasmFallback: false,
				seed: 73
			})
		);
		expect(result.file.name).toBe('ai-music-warm-cinematic-pulse-73.wav');
		expect(result.sampleRate).toBe(48_000);
		expect(progress).toHaveBeenCalledWith(
			expect.objectContaining({
				stage: 'downloading',
				receivedBytes: 500,
				totalBytes: ACE_STEP_STANDARD_DOWNLOAD_BYTES
			})
		);
		expect(progress).toHaveBeenCalledWith(
			expect.objectContaining({ stage: 'generating', message: 'DiT 4/8', progress: 0.5 })
		);
		expect(musicGenerationTags(result)).toEqual([
			'ai-generated',
			'music',
			'ace-step',
			'ace-step-quality:standard',
			'ace-step-seed:73'
		]);
	});

	it('rejects invalid work before it allocates a runtime', async () => {
		const createRuntime = vi.fn();
		const service = new AceStepMusicService(createRuntime);

		await expect(
			service.generate({ prompt: ' ', durationSeconds: 10, audioQuality: 'standard' })
		).rejects.toThrow('Describe the music');
		await expect(
			service.generate({ prompt: 'Music', durationSeconds: 9, audioQuality: 'standard' })
		).rejects.toThrow('10 to 120');
		expect(createRuntime).not.toHaveBeenCalled();
	});

	it('waits behind other GPU media work and cancels without loading the model', async () => {
		const blocker = new AbortController();
		const release = await gpuMediaJobScheduler.acquire(blocker.signal);
		const { runtime } = fakeRuntime();
		const createRuntime = vi.fn(async () => runtime);
		const service = new AceStepMusicService(createRuntime);
		const abort = new AbortController();
		const pending = service.generate({
			prompt: 'Patient ambient bed',
			durationSeconds: 10,
			audioQuality: 'standard',
			signal: abort.signal
		});
		await Promise.resolve();
		expect(createRuntime).not.toHaveBeenCalled();

		abort.abort();
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		expect(createRuntime).not.toHaveBeenCalled();
		release();
	});

	it('preflights the exact audio profile against origin quota and write headroom', async () => {
		const module = await import('ai-music-js');
		const required = module.getRequiredAssets({ audioQuality: 'standard' });
		const { runtime, listCachedModels } = fakeRuntime();
		listCachedModels.mockResolvedValue({
			origin: 'http://localhost:4173',
			cacheName: 'ai-music-js-test',
			expectedBytes: ACE_STEP_STANDARD_DOWNLOAD_BYTES,
			storedBytes: 0,
			readyBytes: 0,
			missingBytes: ACE_STEP_STANDARD_DOWNLOAD_BYTES,
			usageBytes: 0,
			quotaBytes: 1_140_000_000,
			availableBytes: 1_140_000_000,
			persisted: false,
			models: required.map((asset) => ({
				id: asset.group,
				label: asset.label,
				expectedBytes: asset.bytes,
				storedBytes: 0,
				complete: false,
				partial: false,
				assets: [
					{
						id: asset.id,
						group: asset.group,
						label: asset.label,
						fileName: asset.fileName,
						role: asset.role,
						expectedBytes: asset.bytes,
						storedBytes: 0,
						cached: false,
						storage: null
					}
				]
			}))
		});
		const service = new AceStepMusicService(async () => runtime);

		await expect(service.inspectGenerationStorage('standard')).resolves.toEqual(
			expect.objectContaining({
				expectedBytes: ACE_STEP_STANDARD_DOWNLOAD_BYTES,
				missingBytes: ACE_STEP_STANDARD_DOWNLOAD_BYTES,
				headroomBytes: 512_000_000,
				effectiveAvailableBytes: 1_140_000_000,
				sufficient: false,
				persisted: false
			})
		);
	});

	it('disposes a runtime that finishes loading after an explicit unload', async () => {
		const { runtime } = fakeRuntime();
		let resolveRuntime!: (runtime: AceStepRuntime) => void;
		const service = new AceStepMusicService(
			() => new Promise<AceStepRuntime>((resolve) => (resolveRuntime = resolve))
		);
		const pending = service.inspectCache();
		expect(service.isLoaded()).toBe(true);

		service.unload();
		resolveRuntime(runtime);

		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		expect(runtime.dispose).toHaveBeenCalledOnce();
		expect(service.isLoaded()).toBe(false);
	});

	it('clears cached assets with an idle runtime and always disposes it afterward', async () => {
		const { runtime, listCachedModels } = fakeRuntime();
		listCachedModels.mockResolvedValue({
			origin: 'http://localhost:4173',
			cacheName: 'ai-music-js-test',
			expectedBytes: 128,
			storedBytes: 128,
			readyBytes: 128,
			missingBytes: 0,
			usageBytes: 128,
			quotaBytes: 1024,
			availableBytes: 896,
			persisted: true,
			models: []
		});
		const service = new AceStepMusicService(async () => runtime);

		await expect(service.clearCache()).resolves.toBe(true);
		expect(runtime.clearCache).toHaveBeenCalledOnce();
		expect(runtime.dispose).toHaveBeenCalledOnce();
		expect(service.isLoaded()).toBe(false);
	});

	it('rejects work queued before unload instead of loading the model again', async () => {
		const { runtime, generate } = fakeRuntime();
		let resolveFirst!: (result: AceStepGenerationResult) => void;
		generate.mockImplementation(
			() => new Promise<AceStepGenerationResult>((resolve) => (resolveFirst = resolve))
		);
		const service = new AceStepMusicService(async () => runtime);
		const first = service.generate({
			prompt: 'First track',
			durationSeconds: 10,
			audioQuality: 'standard',
			seed: 1
		});
		const queued = service.generate({
			prompt: 'Queued track',
			durationSeconds: 10,
			audioQuality: 'standard',
			seed: 2
		});
		await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());

		service.unload();
		resolveFirst(generationResult(1));

		await expect(first).resolves.toMatchObject({ seed: 1 });
		await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
		expect(generate).toHaveBeenCalledOnce();
	});
});
