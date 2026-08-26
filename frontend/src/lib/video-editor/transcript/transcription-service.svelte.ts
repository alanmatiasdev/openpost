import { mediaPool } from '../media/pool.svelte';
import { mediaTaskId, mediaTasks } from '../media/media-tasks.svelte';
import { resolveMediaBlob } from '../media/resolve-media-blob';
import type { MediaMetadata } from '../media/types';
import type { TimelineItem } from '../project/types';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { m } from '$lib/paraglide/messages';
import type { TranscriptWord } from './cues';
import type {
	ResolvedTranscriptionEngine,
	TranscribeOptions,
	TranscribeProgress,
	TranscriptionSelection
} from './engine/types';
import {
	addGeneratedSubtitleItem,
	captureTranscriptionSource,
	transcribeClip,
	type TranscriptionSourceSnapshot
} from './transcribe-action';
import { isTranscriptionOutOfMemoryError } from './transcription-errors';

export type TranscriptionJobStatus = 'queued' | 'running' | 'cancelling';

export interface TranscriptionJobView {
	id: string;
	itemId: string;
	mediaId: string;
	label: string;
	status: TranscriptionJobStatus;
	progress: TranscribeProgress | null;
	backend: 'webgpu' | 'wasm' | null;
	fallback: ResolvedTranscriptionEngine | null;
}

export interface TranscriptionResult {
	sourceItemId: string;
	subtitleItemId: string;
}

export interface TranscriptionServiceDependencies {
	resolveSource: (media: MediaMetadata) => Promise<Blob>;
	transcribe: (
		item: TimelineItem,
		file: File,
		options: TranscribeOptions
	) => Promise<TranscriptWord[]>;
}

interface TranscriptionTarget {
	id: string;
	item: TimelineItem;
	source: TranscriptionSourceSnapshot;
	taskId: string;
	taskRevision: number;
	promise: Promise<TranscriptionResult>;
	resolve: (result: TranscriptionResult) => void;
	reject: (error: Error) => void;
}

interface QueuedTranscriptionJob {
	id: string;
	requestKey: string;
	media: MediaMetadata;
	selection: TranscriptionSelection;
	controller: AbortController;
	status: Extract<TranscriptionJobStatus, 'queued' | 'running'>;
	progress: TranscribeProgress | null;
	backend: 'webgpu' | 'wasm' | null;
	fallback: ResolvedTranscriptionEngine | null;
	targets: Map<string, TranscriptionTarget>;
}

const DEFAULT_DEPENDENCIES: TranscriptionServiceDependencies = {
	resolveSource: resolveMediaBlob,
	transcribe: transcribeClip
};

function abortError(): DOMException {
	return new DOMException('Transcription cancelled', 'AbortError');
}

function requestKey(
	source: TranscriptionSourceSnapshot,
	selection: TranscriptionSelection
): string {
	return JSON.stringify([
		source.mediaId,
		source.sourceStartSeconds,
		source.sourceEndSeconds,
		selection.model,
		selection.language ?? 'auto',
		selection.quantization
	]);
}

export class TranscriptionService {
	private readonly pending: QueuedTranscriptionJob[] = [];
	private readonly jobsByRequestKey = new Map<string, QueuedTranscriptionJob>();
	private readonly targetByItemId = new Map<
		string,
		{ job: QueuedTranscriptionJob; target: TranscriptionTarget }
	>();
	private active: QueuedTranscriptionJob | null = null;
	private resetting = false;
	private state = $state<Record<string, TranscriptionJobView>>({});

	constructor(
		private readonly dependencies: TranscriptionServiceDependencies = DEFAULT_DEPENDENCIES
	) {}

	get jobs(): TranscriptionJobView[] {
		return Object.values(this.state);
	}

	jobForItem(itemId: string): TranscriptionJobView | undefined {
		const owned = this.targetByItemId.get(itemId);
		return owned ? this.state[owned.target.id] : undefined;
	}

	queuePosition(viewId: string): number | null {
		const index = this.pending.findIndex((job) => job.targets.has(viewId));
		return index < 0 ? null : index + 1;
	}

	enqueue(itemId: string, selection: TranscriptionSelection): Promise<TranscriptionResult> {
		const item = timelineStore.itemById.get(itemId);
		const media = item?.mediaId ? mediaPool.get(item.mediaId) : undefined;
		if (!item || !media) return Promise.reject(new Error(m.video_editor_transcribe_select_media()));
		if (item.type !== 'audio' && item.type !== 'video') {
			return Promise.reject(new Error(m.video_editor_transcribe_media_only()));
		}
		if (media.audioCodecSupported === false) {
			return Promise.reject(new Error(m.video_editor_transcribe_unsupported_audio()));
		}
		const source = captureTranscriptionSource(item);
		const key = requestKey(source, selection);
		const currentTarget = this.targetByItemId.get(itemId);
		if (currentTarget) {
			return currentTarget.job.requestKey === key
				? currentTarget.target.promise
				: Promise.reject(new Error(m.video_editor_transcribe_already_queued()));
		}

		let job = this.jobsByRequestKey.get(key);
		const isNewJob = job === undefined;
		if (!job) {
			job = {
				id: crypto.randomUUID(),
				requestKey: key,
				media,
				selection,
				controller: new AbortController(),
				status: 'queued',
				progress: null,
				backend: null,
				fallback: null,
				targets: new Map()
			};
			this.jobsByRequestKey.set(key, job);
		}

		const target = this.createTarget(job, item, source);
		if (isNewJob) {
			this.pending.push(job);
			void this.drain();
		}
		return target.promise;
	}

	cancelForItem(itemId: string): boolean {
		const owned = this.targetByItemId.get(itemId);
		if (!owned) return false;
		const { job, target } = owned;
		if (job.targets.size > 1) {
			job.targets.delete(target.id);
			this.settleTarget(job, target, abortError());
			return true;
		}
		if (this.active?.id === job.id) {
			this.updateTargetView(target, { status: 'cancelling' });
			mediaTasks.update(
				target.taskId,
				{ status: 'cancelling', stage: 'cancelling' },
				target.taskRevision
			);
			job.controller.abort();
			return true;
		}
		const index = this.pending.findIndex((candidate) => candidate.id === job.id);
		if (index >= 0) this.pending.splice(index, 1);
		this.finishJob(job, abortError());
		return true;
	}

	reset(): void {
		this.resetting = true;
		for (const job of [...this.pending]) this.finishJob(job, abortError());
		this.pending.length = 0;
		const active = this.active;
		active?.controller.abort();
		if (active) this.finishJob(active, abortError());
		this.resetting = false;
	}

	private createTarget(
		job: QueuedTranscriptionJob,
		item: TimelineItem,
		source: TranscriptionSourceSnapshot
	): TranscriptionTarget {
		let resolve!: (result: TranscriptionResult) => void;
		let reject!: (error: Error) => void;
		const promise = new Promise<TranscriptionResult>((resolvePromise, rejectPromise) => {
			resolve = resolvePromise;
			reject = rejectPromise;
		});
		const id = crypto.randomUUID();
		const taskId = mediaTaskId('transcription', item.id);
		const target = {
			id,
			item: $state.snapshot(item),
			source,
			taskId,
			taskRevision: 0,
			promise,
			resolve,
			reject
		} satisfies TranscriptionTarget;
		target.taskRevision = mediaTasks.start({
			id: taskId,
			kind: 'transcription',
			mediaId: job.media.id,
			label: item.label || job.media.fileName,
			stage: job.status === 'running' ? (job.progress?.stage ?? 'preparing') : 'queued',
			status: job.status,
			progress: job.progress?.progress ?? (job.status === 'queued' ? 0 : null),
			onCancel: () => this.cancelForItem(item.id)
		});
		job.targets.set(id, target);
		this.targetByItemId.set(item.id, { job, target });
		this.state[id] = {
			id,
			itemId: item.id,
			mediaId: job.media.id,
			label: item.label || job.media.fileName,
			status: job.status,
			progress: job.progress,
			backend: job.backend,
			fallback: job.fallback
		};
		return target;
	}

	private async drain(): Promise<void> {
		if (this.active || this.resetting) return;
		const job = this.pending.shift();
		if (!job) return;
		this.active = job;
		job.status = 'running';
		for (const target of job.targets.values()) {
			this.updateTargetView(target, { status: 'running' });
			mediaTasks.update(
				target.taskId,
				{ status: 'running', stage: 'preparing', progress: null },
				target.taskRevision
			);
		}
		try {
			const blob = await this.dependencies.resolveSource(job.media);
			if (job.controller.signal.aborted) throw abortError();
			const file =
				blob instanceof File
					? blob
					: new File([blob], job.media.fileName, {
							type: blob.type || job.media.mimeType
						});
			const firstTarget = job.targets.values().next();
			if (firstTarget.done) throw abortError();
			const representative = firstTarget.value;
			const run = (model = job.selection.model): Promise<TranscriptWord[]> =>
				this.dependencies.transcribe(representative.item, file, {
					...job.selection,
					model,
					sourceStartSeconds: representative.source.sourceStartSeconds,
					sourceEndSeconds: representative.source.sourceEndSeconds,
					signal: job.controller.signal,
					onProgress: (progress) => this.publishProgress(job, progress),
					onRuntimeInfo: (runtime) => {
						if (!runtime.backend) return;
						job.backend = runtime.backend;
						for (const target of job.targets.values()) {
							this.updateTargetView(target, { backend: runtime.backend });
						}
					},
					onFallback: (fallback) => this.publishFallback(job, fallback)
				});
			let words: TranscriptWord[];
			try {
				words = await run();
			} catch (error) {
				if (
					job.selection.model !== 'whisper-large' ||
					job.controller.signal.aborted ||
					!isTranscriptionOutOfMemoryError(error)
				) {
					throw error;
				}
				this.publishFallback(job, {
					engine: 'whisper',
					model: 'whisper-small',
					fallbackReason: 'out-of-memory'
				});
				this.publishProgress(job, { stage: 'preparing', progress: 0, restarted: true });
				words = await run('whisper-small');
			}
			if (job.controller.signal.aborted) throw abortError();
			this.finishJob(job, undefined, words);
		} catch (error) {
			this.finishJob(job, error instanceof Error ? error : new Error(String(error)));
		}
	}

	private publishFallback(
		job: QueuedTranscriptionJob,
		fallback: ResolvedTranscriptionEngine
	): void {
		job.fallback = fallback;
		for (const target of job.targets.values()) {
			this.updateTargetView(target, { fallback });
		}
	}

	private publishProgress(job: QueuedTranscriptionJob, progress: TranscribeProgress): void {
		job.progress = progress;
		for (const target of job.targets.values()) {
			this.updateTargetView(target, { progress });
			mediaTasks.update(
				target.taskId,
				{
					stage: progress.stage,
					progress: progress.indeterminate ? null : progress.progress,
					receivedBytes: progress.receivedBytes,
					totalBytes: progress.totalBytes
				},
				target.taskRevision
			);
		}
	}

	private updateTargetView(
		target: TranscriptionTarget,
		patch: Partial<TranscriptionJobView>
	): void {
		const current = this.state[target.id];
		if (!current) return;
		this.state[target.id] = { ...current, ...patch };
	}

	private finishJob(job: QueuedTranscriptionJob, error?: Error, words?: TranscriptWord[]): void {
		if (this.jobsByRequestKey.get(job.requestKey)?.id !== job.id) return;
		this.jobsByRequestKey.delete(job.requestKey);
		if (this.active?.id === job.id) this.active = null;
		for (const target of [...job.targets.values()]) {
			if (error || !words) {
				this.settleTarget(job, target, error ?? new Error(m.video_editor_transcribe_no_result()));
				continue;
			}
			try {
				const subtitleItemId = addGeneratedSubtitleItem(target.item.id, words, target.source);
				this.settleTarget(job, target, undefined, {
					sourceItemId: target.item.id,
					subtitleItemId
				});
			} catch (targetError) {
				this.settleTarget(
					job,
					target,
					targetError instanceof Error ? targetError : new Error(String(targetError))
				);
			}
		}
		if (!this.resetting) void this.drain();
	}

	private settleTarget(
		job: QueuedTranscriptionJob,
		target: TranscriptionTarget,
		error?: Error,
		result?: TranscriptionResult
	): void {
		job.targets.delete(target.id);
		mediaTasks.finish(target.taskId, target.taskRevision);
		const owned = this.targetByItemId.get(target.item.id);
		if (owned?.target.id === target.id) this.targetByItemId.delete(target.item.id);
		delete this.state[target.id];
		if (error) target.reject(error);
		else if (result) target.resolve(result);
	}
}

export const transcriptionService = new TranscriptionService();
