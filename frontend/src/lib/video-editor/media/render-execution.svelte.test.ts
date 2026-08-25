import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../project/types';
import { setWorkspaceRoot } from '../workspace-fs/root';
import { removeEntry, writeBlob } from '../workspace-fs/fs-primitives';
import { mediaSourceByFileName } from '../workspace-fs/paths';
import {
	renderExportArtifact,
	type RenderExecutionDependencies,
	type RenderExecutionJob,
	type RenderWorkerPort
} from './render-execution';
import type { RenderedExportArtifact, RenderExportProgress } from './render-export';
import type {
	RenderExportWorkerRequest,
	RenderExportWorkerResponse
} from './render-export-worker.types';
import { mediaPool } from './pool.svelte';
import proResFixtureUrl from './fixtures/prores-proxy.mov?url';

const project: Project = {
	id: 'worker-project',
	name: 'Worker project',
	description: '',
	createdAt: 0,
	updatedAt: 0,
	duration: 2 / 30,
	metadata: { width: 16, height: 16, fps: 30 },
	timeline: {
		tracks: [
			{
				id: 'video-track',
				name: 'Video',
				kind: 'video',
				height: 64,
				locked: false,
				visible: true,
				muted: false,
				solo: false,
				order: 0
			}
		],
		items: [
			{
				id: 'shape',
				trackId: 'video-track',
				from: 0,
				durationInFrames: 2,
				label: 'Square',
				type: 'shape',
				shapeType: 'rectangle',
				fillEnabled: true,
				fillColor: '#ff0000',
				transform: { x: 0, y: 0, width: 16, height: 16 }
			}
		]
	}
};

const artifact: RenderedExportArtifact = {
	fileName: 'worker.webm',
	blob: new Blob(['rendered'], { type: 'video/webm' })
};

class FakeWorker extends EventTarget {
	readonly messages: RenderExportWorkerRequest[] = [];
	terminated = false;

	constructor(
		private readonly respond?: (worker: FakeWorker, message: RenderExportWorkerRequest) => void
	) {
		super();
	}

	postMessage(message: RenderExportWorkerRequest): void {
		this.messages.push(message);
		this.respond?.(this, message);
	}

	send(message: RenderExportWorkerResponse): void {
		this.dispatchEvent(new MessageEvent('message', { data: message }));
	}

	terminate(): void {
		this.terminated = true;
	}
}

function fakeWorkerFactory(worker: FakeWorker): () => RenderWorkerPort {
	return () => worker;
}

function dependencies(
	worker: FakeWorker,
	overrides: Partial<RenderExecutionDependencies> = {}
): RenderExecutionDependencies {
	// SAFETY: worker tests never dereference the root because FakeWorker intercepts the message.
	const workspaceRoot = {} as FileSystemDirectoryHandle;
	return {
		workerAvailable: () => true,
		createWorker: fakeWorkerFactory(worker),
		workspaceRoot: () => workspaceRoot,
		media: () => [],
		renderVideoMain: vi.fn(async () => artifact),
		renderAudioMain: vi.fn(async () => artifact),
		...overrides
	};
}

function videoJob(options: Partial<RenderExecutionJob> = {}): RenderExecutionJob {
	return {
		mode: 'video',
		project,
		videoOptions: { format: 'webm', codec: 'vp8', width: 16, height: 16 },
		...options
	};
}

afterEach(() => {
	mediaPool.clear();
	setWorkspaceRoot(null);
});

describe('render export worker execution', () => {
	it('returns worker output and forwards progress without calling the fallback', async () => {
		const progress: RenderExportProgress[] = [];
		const worker = new FakeWorker((current, message) => {
			if (message.type !== 'start') return;
			queueMicrotask(() => {
				current.send({
					type: 'progress',
					requestId: message.requestId,
					progress: { phase: 'rendering', framesDone: 1, totalFrames: 2, progress: 0.5 }
				});
				current.send({ type: 'complete', requestId: message.requestId, artifact });
			});
		});
		const deps = dependencies(worker);

		const outcome = await renderExportArtifact(
			videoJob({ onProgress: (value) => progress.push(value) }),
			deps
		);

		expect(outcome).toMatchObject({ renderPath: 'worker', artifact });
		expect(progress).toEqual([
			{ phase: 'rendering', framesDone: 1, totalFrames: 2, progress: 0.5 }
		]);
		expect(deps.renderVideoMain).not.toHaveBeenCalled();
		expect(worker.terminated).toBe(true);
	});

	it('falls back only for an explicit worker limitation', async () => {
		const worker = new FakeWorker((current, message) => {
			if (message.type !== 'start') return;
			queueMicrotask(() =>
				current.send({
					type: 'error',
					requestId: message.requestId,
					error: 'WORKER_REQUIRES_MAIN_THREAD:audio-context'
				})
			);
		});
		const renderVideoMain = vi.fn(async () => artifact);
		const deps = dependencies(worker, { renderVideoMain });

		const outcome = await renderExportArtifact(videoJob(), deps);

		expect(outcome).toMatchObject({
			renderPath: 'main-thread',
			fallbackReason: 'WORKER_REQUIRES_MAIN_THREAD:audio-context',
			artifact
		});
		expect(renderVideoMain).toHaveBeenCalledOnce();
		expect(worker.terminated).toBe(true);
	});

	it('does not hide a worker render failure behind a second render', async () => {
		const worker = new FakeWorker((current, message) => {
			if (message.type !== 'start') return;
			queueMicrotask(() =>
				current.send({ type: 'error', requestId: message.requestId, error: 'Encoder failed' })
			);
		});
		const renderVideoMain = vi.fn(async () => artifact);
		const deps = dependencies(worker, { renderVideoMain });

		await expect(renderExportArtifact(videoJob(), deps)).rejects.toThrow('Encoder failed');
		expect(renderVideoMain).not.toHaveBeenCalled();
		expect(worker.terminated).toBe(true);
	});

	it('terminates the worker and rejects immediately when cancelled', async () => {
		const worker = new FakeWorker();
		const controller = new AbortController();
		const pending = renderExportArtifact(
			videoJob({ signal: controller.signal }),
			dependencies(worker)
		);

		controller.abort();

		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		expect(worker.messages.map((message) => message.type)).toEqual(['start', 'cancel']);
		expect(worker.terminated).toBe(true);
	});

	it('reads workspace media and renders it inside a real dedicated worker', async () => {
		const root = await navigator.storage.getDirectory();
		setWorkspaceRoot(root);
		const mediaId = 'worker-image-source';
		const fileName = 'worker-source.png';
		const canvas = new OffscreenCanvas(16, 16);
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Expected an OffscreenCanvas 2D context');
		context.fillStyle = '#ff0000';
		context.fillRect(0, 0, 16, 16);
		const source = await canvas.convertToBlob({ type: 'image/png' });
		await writeBlob(root, mediaSourceByFileName(mediaId, fileName), source);
		mediaPool.upsert(
			{
				id: mediaId,
				storageType: 'workspace',
				fileName,
				fileSize: source.size,
				mimeType: 'image/png',
				duration: 0,
				width: 16,
				height: 16,
				fps: 0,
				codec: 'png',
				bitrate: 0,
				tags: ['image']
			},
			'ready'
		);
		const baseTimeline = project.timeline;
		const baseItem = baseTimeline?.items[0];
		if (!baseTimeline || !baseItem) throw new Error('Expected the worker test timeline');
		const imageProject: Project = {
			...project,
			timeline: {
				...baseTimeline,
				items: [
					{
						...baseItem,
						type: 'image',
						mediaId,
						label: 'Worker image',
						shapeType: undefined,
						fillEnabled: undefined,
						fillColor: undefined,
						sourceWidth: 16,
						sourceHeight: 16
					}
				]
			}
		};
		const phases: RenderExportProgress['phase'][] = [];
		try {
			const outcome = await renderExportArtifact(
				videoJob({ project: imageProject, onProgress: (progress) => phases.push(progress.phase) })
			);

			expect(outcome.fallbackReason).toBeUndefined();
			expect(outcome.renderPath).toBe('worker');
			expect(outcome.artifact.fileName).toBe('Worker project.webm');
			expect(outcome.artifact.blob.type).toBe('video/webm');
			expect(outcome.artifact.blob.size).toBeGreaterThan(0);
			expect(phases).toContain('rendering');
			expect(phases.at(-1)).toBe('finalizing');
		} finally {
			await removeEntry(root, ['media', mediaId], { recursive: true });
		}
	});

	it('decodes the original ProRes source inside the real export worker', async () => {
		const response = await fetch(proResFixtureUrl);
		expect(response.ok).toBe(true);
		const source = await response.blob();
		const root = await navigator.storage.getDirectory();
		setWorkspaceRoot(root);
		const mediaId = 'worker-prores-source';
		const fileName = 'prores-proxy.mov';
		await writeBlob(root, mediaSourceByFileName(mediaId, fileName), source);
		mediaPool.upsert(
			{
				id: mediaId,
				storageType: 'workspace',
				fileName,
				fileSize: source.size,
				mimeType: 'video/quicktime',
				duration: 0.125,
				width: 64,
				height: 36,
				fps: 24,
				codec: 'prores',
				bitrate: 90_000,
				videoCodecSupported: false,
				tags: ['video']
			},
			'ready'
		);
		const proResProject: Project = {
			...project,
			duration: 0.125,
			metadata: { width: 64, height: 36, fps: 24 },
			timeline: {
				tracks: project.timeline?.tracks ?? [],
				items: [
					{
						id: 'prores-clip',
						trackId: 'video-track',
						from: 0,
						durationInFrames: 3,
						label: 'ProRes source',
						type: 'video',
						mediaId,
						sourceStart: 0,
						sourceEnd: 3,
						sourceDuration: 3,
						sourceFps: 24,
						transform: { x: 0, y: 0, width: 64, height: 36 }
					}
				]
			}
		};

		try {
			const outcome = await renderExportArtifact(
				videoJob({
					project: proResProject,
					videoOptions: { format: 'webm', codec: 'vp8', width: 64, height: 36 }
				})
			);

			expect(outcome.fallbackReason).toBeUndefined();
			expect(outcome.renderPath).toBe('worker');
			expect(outcome.artifact.blob.type).toBe('video/webm');
			expect(outcome.artifact.blob.size).toBeGreaterThan(0);
		} finally {
			await removeEntry(root, ['media', mediaId], { recursive: true });
		}
	});
});
