import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaMetadata } from '../media/types';
import { mediaPool } from '../media/pool.svelte';
import { mediaTasks } from '../media/media-tasks.svelte';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import type { TranscriptWord } from './cues';
import type { TranscribeOptions, TranscriptionSelection } from './engine/types';
import {
	TranscriptionService,
	type TranscriptionServiceDependencies
} from './transcription-service.svelte';

const track: TimelineTrack = {
	id: 'video',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const firstItem: TimelineItem = {
	id: 'first',
	trackId: track.id,
	from: 0,
	durationInFrames: 90,
	label: 'First interview',
	type: 'video',
	mediaId: 'media',
	sourceStart: 0,
	sourceEnd: 90,
	sourceFps: 30
};

const secondItem: TimelineItem = {
	...firstItem,
	id: 'second',
	from: 120,
	label: 'Second interview',
	sourceStart: 90,
	sourceEnd: 180
};

const repeatedItem: TimelineItem = {
	...firstItem,
	id: 'repeat',
	from: 240,
	label: 'Repeated interview'
};

const media: MediaMetadata = {
	id: 'media',
	storageType: 'workspace',
	fileName: 'interview.mp4',
	fileSize: 100,
	mimeType: 'video/mp4',
	duration: 6,
	width: 1920,
	height: 1080,
	fps: 30,
	codec: 'avc',
	bitrate: 1_000,
	tags: ['video']
};

const selection: TranscriptionSelection = {
	model: 'whisper-base',
	language: 'en',
	quantization: 'hybrid'
};

interface PendingTranscription {
	itemId: string;
	options: TranscribeOptions;
	resolve: (words: TranscriptWord[]) => void;
	reject: (error: Error) => void;
}

interface ControlledDependencies {
	dependencies: TranscriptionServiceDependencies;
	pending: PendingTranscription[];
}

function controlledDependencies(): ControlledDependencies {
	const pending: PendingTranscription[] = [];
	return {
		pending,
		dependencies: {
			resolveSource: vi.fn(async () => new Blob(['source'], { type: 'video/mp4' })),
			transcribe: vi.fn((item, _file, options) => {
				return new Promise<TranscriptWord[]>((resolve, reject) => {
					const entry = { itemId: item.id, options, resolve, reject };
					pending.push(entry);
					options.signal?.addEventListener(
						'abort',
						() => reject(new DOMException('Transcription cancelled', 'AbortError')),
						{ once: true }
					);
				});
			})
		}
	};
}

beforeEach(() => {
	commandHistory.clearHistory();
	mediaTasks.reset();
	mediaPool.clear();
	mediaPool.upsert(media, 'ready');
	timelineStore.__resetForTesting();
	timelineStore.setAll({
		tracks: [track],
		items: [firstItem, secondItem, repeatedItem],
		fps: 30
	});
});

describe('TranscriptionService', () => {
	it('coalesces identical requests and serializes distinct clip windows', async () => {
		const { dependencies, pending } = controlledDependencies();
		const service = new TranscriptionService(dependencies);
		const first = service.enqueue(firstItem.id, selection);
		const duplicate = service.enqueue(firstItem.id, selection);
		const second = service.enqueue(secondItem.id, selection);

		expect(duplicate).toBe(first);
		await vi.waitFor(() => expect(pending).toHaveLength(1));
		expect(pending[0]?.itemId).toBe(firstItem.id);
		expect(service.jobForItem(firstItem.id)).toMatchObject({ status: 'running' });
		expect(service.jobForItem(secondItem.id)).toMatchObject({ status: 'queued' });
		expect(service.queuePosition(service.jobForItem(secondItem.id)!.id)).toBe(1);

		pending[0]!.resolve([{ text: 'First', startSeconds: 0, endSeconds: 1 }]);
		await expect(first).resolves.toMatchObject({ sourceItemId: firstItem.id });
		await expect(duplicate).resolves.toMatchObject({ sourceItemId: firstItem.id });
		await vi.waitFor(() => expect(pending).toHaveLength(2));
		expect(pending[1]?.itemId).toBe(secondItem.id);

		pending[1]!.resolve([{ text: 'Second', startSeconds: 0, endSeconds: 1 }]);
		await expect(second).resolves.toMatchObject({ sourceItemId: secondItem.id });
		expect(
			timelineStore.items.filter((item) => item.captionSource?.type === 'transcript')
		).toHaveLength(2);
		expect(service.jobs).toHaveLength(0);
		expect(mediaTasks.list).toHaveLength(0);
	});

	it('shares one decode across repeated placements of the same source window', async () => {
		const { dependencies, pending } = controlledDependencies();
		const service = new TranscriptionService(dependencies);
		const first = service.enqueue(firstItem.id, selection);
		const repeated = service.enqueue(repeatedItem.id, selection);

		await vi.waitFor(() => expect(pending).toHaveLength(1));
		pending[0]!.resolve([{ text: 'Shared', startSeconds: 0, endSeconds: 1 }]);
		await expect(first).resolves.toMatchObject({ sourceItemId: firstItem.id });
		await expect(repeated).resolves.toMatchObject({ sourceItemId: repeatedItem.id });
		expect(dependencies.transcribe).toHaveBeenCalledOnce();
		expect(
			timelineStore.items.filter((item) => item.captionSource?.type === 'transcript')
		).toHaveLength(2);
	});

	it('cancels one coalesced placement without aborting the shared decode', async () => {
		const { dependencies, pending } = controlledDependencies();
		const service = new TranscriptionService(dependencies);
		const first = service.enqueue(firstItem.id, selection);
		const repeated = service.enqueue(repeatedItem.id, selection);

		await vi.waitFor(() => expect(pending).toHaveLength(1));
		expect(service.cancelForItem(repeatedItem.id)).toBe(true);
		await expect(repeated).rejects.toMatchObject({ name: 'AbortError' });
		expect(pending[0]!.options.signal?.aborted).toBe(false);

		pending[0]!.resolve([{ text: 'First only', startSeconds: 0, endSeconds: 1 }]);
		await expect(first).resolves.toMatchObject({ sourceItemId: firstItem.id });
		expect(
			timelineStore.items.filter((item) => item.captionSource?.type === 'transcript')
		).toHaveLength(1);
	});

	it('cancels queued and active jobs without blocking the next request', async () => {
		const { dependencies, pending } = controlledDependencies();
		const service = new TranscriptionService(dependencies);
		const first = service.enqueue(firstItem.id, selection);
		const second = service.enqueue(secondItem.id, selection);

		await vi.waitFor(() => expect(pending).toHaveLength(1));
		expect(service.cancelForItem(secondItem.id)).toBe(true);
		await expect(second).rejects.toMatchObject({ name: 'AbortError' });
		expect(service.jobForItem(secondItem.id)).toBeUndefined();

		expect(service.cancelForItem(firstItem.id)).toBe(true);
		await expect(first).rejects.toMatchObject({ name: 'AbortError' });
		expect(service.jobs).toHaveLength(0);
		expect(mediaTasks.list).toHaveLength(0);
	});

	it('discards a completed result when the source window changed during transcription', async () => {
		const { dependencies, pending } = controlledDependencies();
		const service = new TranscriptionService(dependencies);
		const result = service.enqueue(firstItem.id, selection);
		await vi.waitFor(() => expect(pending).toHaveLength(1));
		timelineStore._updateItems([{ id: firstItem.id, patch: { speed: 2 } }]);
		pending[0]!.resolve([{ text: 'Stale', startSeconds: 0, endSeconds: 1 }]);

		await expect(result).rejects.toThrow('changed while transcription was running');
		expect(timelineStore.items.some((item) => item.type === 'subtitle')).toBe(false);
		expect(commandHistory.undoStack).toHaveLength(0);
	});

	it('publishes progress and runtime details only on the owning job', async () => {
		const { dependencies, pending } = controlledDependencies();
		const service = new TranscriptionService(dependencies);
		const result = service.enqueue(firstItem.id, selection);
		await vi.waitFor(() => expect(pending).toHaveLength(1));

		pending[0]!.options.onProgress?.({ stage: 'decoding', progress: 0.4 });
		pending[0]!.options.onRuntimeInfo?.({ backend: 'webgpu' });
		pending[0]!.options.onFallback?.({
			engine: 'whisper',
			model: 'whisper-small',
			fallbackReason: 'no-webgpu'
		});
		expect(service.jobForItem(firstItem.id)).toMatchObject({
			progress: { stage: 'decoding', progress: 0.4 },
			backend: 'webgpu',
			fallback: { model: 'whisper-small' }
		});

		pending[0]!.resolve([{ text: 'Done', startSeconds: 0, endSeconds: 1 }]);
		await result;
	});

	it('retries Whisper Large with Whisper Small after a browser memory failure', async () => {
		const { dependencies, pending } = controlledDependencies();
		const service = new TranscriptionService(dependencies);
		const result = service.enqueue(firstItem.id, { ...selection, model: 'whisper-large' });
		await vi.waitFor(() => expect(pending).toHaveLength(1));
		pending[0]!.reject(new RangeError('Array buffer allocation failed'));

		await vi.waitFor(() => expect(pending).toHaveLength(2));
		expect(pending[1]?.options.model).toBe('whisper-small');
		expect(service.jobForItem(firstItem.id)).toMatchObject({
			status: 'running',
			fallback: { model: 'whisper-small', fallbackReason: 'out-of-memory' },
			progress: { stage: 'preparing', progress: 0, restarted: true }
		});

		pending[1]!.resolve([{ text: 'Recovered', startSeconds: 0, endSeconds: 1 }]);
		await expect(result).resolves.toMatchObject({ sourceItemId: firstItem.id });
	});
});
