import type { Project } from '../project/types';
import { getWorkspaceRoot } from '../workspace-fs/root';
import { mediaPool } from './pool.svelte';
import type {
	AudioExportOptions,
	RenderedExportArtifact,
	RenderExportOptions,
	RenderExportProgress,
	RenderExportResult
} from './render-export';
import { saveRenderedExportArtifact } from './persist-rendered-export';
import type {
	RenderExportWorkerRequest,
	RenderExportWorkerResponse,
	WorkerAudioExportOptions,
	WorkerVideoExportOptions
} from './render-export-worker.types';
import type { MediaMetadata } from './types';

export interface RenderExecutionOutcome {
	artifact: RenderedExportArtifact;
	renderPath: 'worker' | 'main-thread';
	fallbackReason?: string;
}

export interface RenderExecutionJob {
	mode: 'video' | 'audio';
	project: Project;
	videoOptions?: WorkerVideoExportOptions;
	audioOptions?: WorkerAudioExportOptions;
	signal?: AbortSignal;
	onProgress?: (progress: RenderExportProgress) => void;
}

export interface RenderWorkerPort extends EventTarget {
	postMessage(message: RenderExportWorkerRequest): void;
	terminate(): void;
}

export interface RenderExecutionDependencies {
	workerAvailable: () => boolean;
	createWorker: () => RenderWorkerPort;
	workspaceRoot: () => FileSystemDirectoryHandle | null;
	media: () => MediaMetadata[];
	renderVideoMain: (
		project: Project,
		options?: RenderExportOptions
	) => Promise<RenderedExportArtifact>;
	renderAudioMain: (
		project: Project,
		options: AudioExportOptions
	) => Promise<RenderedExportArtifact>;
}

const defaultDependencies: RenderExecutionDependencies = {
	workerAvailable: () => typeof Worker !== 'undefined',
	createWorker: () =>
		new Worker(new URL('./render-export.worker.ts', import.meta.url), { type: 'module' }),
	workspaceRoot: getWorkspaceRoot,
	media: () => mediaPool.mediaList,
	renderVideoMain: async (project, options) =>
		(await import('./render-export')).renderMultiTrackVideoArtifact(project, options),
	renderAudioMain: async (project, options) =>
		(await import('./render-export')).renderTimelineAudioArtifact(project, options)
};

function cloneMedia(media: MediaMetadata): MediaMetadata {
	const { fileHandle, ...serializable } = media;
	return {
		// SAFETY: every metadata field except the separately restored file handle is JSON data.
		...(JSON.parse(JSON.stringify(serializable)) as Omit<MediaMetadata, 'fileHandle'>),
		fileHandle
	};
}

function abortError(): DOMException {
	return new DOMException('Render cancelled', 'AbortError');
}

function isAbort(error: Error | string): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

function fallbackReason(error: Error | string): string | null {
	const message = error instanceof Error ? error.message : String(error);
	return message.startsWith('WORKER_REQUIRES_MAIN_THREAD:') ||
		message.startsWith('WORKER_UNAVAILABLE:') ||
		message.startsWith('WORKER_RUNTIME_ERROR:') ||
		message.startsWith('WORKER_MESSAGE_ERROR:')
		? message
		: null;
}

function renderInWorker(
	job: RenderExecutionJob,
	dependencies: RenderExecutionDependencies
): Promise<RenderedExportArtifact> {
	if (!dependencies.workerAvailable()) {
		return Promise.reject(new Error('WORKER_UNAVAILABLE:worker-api'));
	}
	const workspaceRoot = dependencies.workspaceRoot();
	if (!workspaceRoot) {
		return Promise.reject(new Error('WORKER_UNAVAILABLE:workspace-root'));
	}
	if (job.signal?.aborted) return Promise.reject(abortError());

	return new Promise<RenderedExportArtifact>((resolve, reject) => {
		let worker: RenderWorkerPort;
		try {
			worker = dependencies.createWorker();
		} catch (error) {
			reject(new Error(`WORKER_UNAVAILABLE:create:${String(error)}`));
			return;
		}
		const requestId = crypto.randomUUID();
		let settled = false;
		const cleanup = (): void => {
			job.signal?.removeEventListener('abort', onAbort);
			worker.removeEventListener('message', onMessage);
			worker.removeEventListener('messageerror', onMessageError);
			worker.removeEventListener('error', onError);
			worker.terminate();
		};
		const finish = (fn: () => void): void => {
			if (settled) return;
			settled = true;
			cleanup();
			fn();
		};
		const onAbort = (): void => {
			try {
				worker.postMessage({ type: 'cancel', requestId } satisfies RenderExportWorkerRequest);
			} catch {
				// Termination below is the authoritative cancellation path.
			} finally {
				finish(() => reject(abortError()));
			}
		};
		const onMessage = (event: Event): void => {
			if (!(event instanceof MessageEvent)) return;
			const response: RenderExportWorkerResponse = event.data;
			if (response.requestId !== requestId) return;
			switch (response.type) {
				case 'progress':
					job.onProgress?.(response.progress);
					break;
				case 'complete':
					finish(() => resolve(response.artifact));
					break;
				case 'cancelled':
					finish(() => reject(abortError()));
					break;
				case 'error':
					finish(() => reject(new Error(response.error)));
					break;
			}
		};
		const onError = (event: Event): void => {
			const message = event instanceof ErrorEvent ? event.message : 'unknown worker error';
			finish(() => reject(new Error(`WORKER_RUNTIME_ERROR:${message}`)));
		};
		const onMessageError = (): void => {
			finish(() => reject(new Error('WORKER_RUNTIME_ERROR:message-deserialization')));
		};
		worker.addEventListener('message', onMessage);
		worker.addEventListener('messageerror', onMessageError);
		worker.addEventListener('error', onError);
		job.signal?.addEventListener('abort', onAbort, { once: true });

		const common = {
			type: 'start' as const,
			requestId,
			project: job.project,
			media: dependencies.media().map(cloneMedia),
			workspaceRoot
		};
		const request: RenderExportWorkerRequest =
			job.mode === 'video'
				? { ...common, mode: 'video', options: job.videoOptions ?? {} }
				: {
						...common,
						mode: 'audio',
						options: job.audioOptions ?? { format: 'wav' }
					};
		try {
			worker.postMessage(request);
		} catch (error) {
			finish(() => reject(new Error(`WORKER_MESSAGE_ERROR:${String(error)}`)));
		}
	});
}

export async function renderExportArtifact(
	job: RenderExecutionJob,
	dependencies: RenderExecutionDependencies = defaultDependencies
): Promise<RenderExecutionOutcome> {
	try {
		return { artifact: await renderInWorker(job, dependencies), renderPath: 'worker' };
	} catch (cause) {
		const error = cause instanceof Error ? cause : String(cause);
		if (isAbort(error)) throw error;
		const reason = fallbackReason(error);
		if (!reason) throw error;
		if (job.signal?.aborted) throw abortError();
		const artifact =
			job.mode === 'video'
				? await dependencies.renderVideoMain(job.project, {
						...(job.videoOptions ?? {}),
						signal: job.signal,
						onProgress: job.onProgress
					})
				: await dependencies.renderAudioMain(job.project, {
						...(job.audioOptions ?? { format: 'wav' }),
						signal: job.signal,
						onProgress: job.onProgress
					});
		return { artifact, renderPath: 'main-thread', fallbackReason: reason };
	}
}

export async function renderVideoExport(
	project: Project,
	options: RenderExportOptions = {}
): Promise<RenderExportResult> {
	const { signal, onProgress, ...videoOptions } = options;
	const outcome = await renderExportArtifact({
		mode: 'video',
		project,
		videoOptions,
		signal,
		onProgress
	});
	return saveRenderedExportArtifact(project.id, outcome.artifact);
}

export async function renderAudioExport(
	project: Project,
	options: AudioExportOptions
): Promise<RenderExportResult> {
	const { signal, onProgress, ...audioOptions } = options;
	const outcome = await renderExportArtifact({
		mode: 'audio',
		project,
		audioOptions,
		signal,
		onProgress
	});
	return saveRenderedExportArtifact(project.id, outcome.artifact);
}
