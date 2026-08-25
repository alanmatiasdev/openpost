import { afterEach, describe, expect, it, vi } from 'vitest';
import { BufferTarget, Output, VideoSample, VideoSampleSource, WebMOutputFormat } from 'mediabunny';
import { filmstripCache, type Filmstrip } from './filmstrip-client';
import { loadFilmstrip } from './filmstrip-persistence';
import type { MediaMetadata } from './types';
import { mediaTaskId, mediaTasks } from './media-tasks.svelte';

function linkedFileHandle(name: string, file: File | Promise<File>): FileSystemFileHandle {
	const handle: FileSystemFileHandle = {
		kind: 'file',
		name,
		getFile: async () => file,
		async createWritable() {
			throw new Error('This read-only test handle cannot write.');
		},
		async createSyncAccessHandle() {
			throw new Error('This read-only test handle cannot open synchronous access.');
		},
		async isSameEntry(other) {
			return other === handle;
		}
	};
	return handle;
}

async function sourceVideo(durationSeconds = 1): Promise<File> {
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const source = new VideoSampleSource({ codec: 'vp8', bitrate: 200_000, keyFrameInterval: 1 });
	output.addVideoTrack(source, { frameRate: 2 });
	await output.start();
	const canvas = new OffscreenCanvas(320, 180);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable.');
	const colors = Array.from({ length: durationSeconds * 2 }, (_, frame) =>
		frame % 2 === 0 ? '#dc2626' : '#2563eb'
	);
	for (const [frame, color] of colors.entries()) {
		context.fillStyle = color;
		context.fillRect(0, 0, canvas.width, canvas.height);
		const sample = new VideoSample(canvas, { timestamp: frame / 2, duration: 0.5 });
		await source.add(sample);
		sample.close();
	}
	source.close();
	await output.finalize();
	if (!target.buffer) throw new Error('Source render produced no bytes.');
	return new File([target.buffer], 'filmstrip-source.webm', { type: 'video/webm' });
}

afterEach(() => {
	filmstripCache.__resetForTesting();
});

describe('filmstrip cache maintenance', () => {
	it('streams viewport targets first without skipping later source seconds', async () => {
		const file = await sourceVideo(3);
		const id = `filmstrip-priority-${crypto.randomUUID()}`;
		const media: MediaMetadata = {
			id,
			storageType: 'handle',
			fileHandle: linkedFileHandle(file.name, file),
			fileName: file.name,
			fileSize: file.size,
			mimeType: file.type,
			duration: 3,
			width: 320,
			height: 180,
			fps: 2,
			codec: 'vp8',
			bitrate: 200_000,
			tags: ['video']
		};
		const updates: Filmstrip[] = [];
		const unsubscribe = filmstripCache.subscribe(id, (value) => updates.push(value));

		const generated = await filmstripCache.getFilmstrip(media, { targetFrameIndices: [2] });

		expect(generated.frames.map((frame) => frame.index)).toEqual([0, 1, 2]);
		const firstPaint = updates.find((update) => update.frames.length > 0);
		expect(firstPaint?.frames.map((frame) => frame.index)).toEqual([2]);
		expect(firstPaint?.frames[0]?.bitmap).toBeInstanceOf(ImageBitmap);
		unsubscribe();
	});

	it('cancels queued extraction and can restart from the same source', async () => {
		const file = await sourceVideo();
		const id = `filmstrip-cancel-${crypto.randomUUID()}`;
		let releaseSource: ((file: File) => void) | undefined;
		const sourceReady = new Promise<File>((resolve) => (releaseSource = resolve));
		const media: MediaMetadata = {
			id,
			storageType: 'handle',
			fileHandle: linkedFileHandle(file.name, sourceReady),
			fileName: file.name,
			fileSize: file.size,
			mimeType: file.type,
			duration: 1,
			width: 320,
			height: 180,
			fps: 2,
			codec: 'vp8',
			bitrate: 200_000,
			tags: ['video']
		};

		const request = filmstripCache.getFilmstrip(media);
		const taskId = mediaTaskId('filmstrip', id);
		await vi.waitFor(() => expect(mediaTasks.get(taskId)?.cancellable).toBe(true));
		const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
		expect(mediaTasks.cancel(taskId)).toBe(true);
		releaseSource?.(file);
		await rejection;
		expect(mediaTasks.get(taskId)).toBeUndefined();
		expect(filmstripCache.cachedFilmstrip(id)?.isExtracting).toBe(false);

		const retried = await filmstripCache.getFilmstrip(media);
		expect(retried.frames.length).toBeGreaterThan(0);
	});

	it('removes decoded memory and OPFS frames without touching the source', async () => {
		const file = await sourceVideo();
		const id = `filmstrip-clear-${crypto.randomUUID()}`;
		const media: MediaMetadata = {
			id,
			storageType: 'handle',
			fileHandle: linkedFileHandle(file.name, file),
			fileName: file.name,
			fileSize: file.size,
			mimeType: file.type,
			duration: 1,
			width: 320,
			height: 180,
			fps: 2,
			codec: 'vp8',
			bitrate: 200_000,
			tags: ['video']
		};
		const updates: Filmstrip[] = [];
		const unsubscribe = filmstripCache.subscribe(id, (value) => updates.push(value));

		const generated = await filmstripCache.getFilmstrip(media);
		expect(generated.frames.length).toBeGreaterThan(0);
		expect(generated.frames.every((frame) => frame.bitmap instanceof ImageBitmap)).toBe(true);
		expect(
			updates.some(
				(update) =>
					update.isExtracting && update.frames.some((frame) => frame.bitmap instanceof ImageBitmap)
			)
		).toBe(true);
		await vi.waitFor(async () => {
			expect((await loadFilmstrip(id)).length).toBeGreaterThan(0);
		});

		await filmstripCache.clearMedia(id);

		expect(filmstripCache.cachedFilmstrip(id)).toBeNull();
		expect(await loadFilmstrip(id)).toEqual([]);
		expect(updates.at(-1)?.frames).toEqual([]);
		await expect(media.fileHandle?.getFile()).resolves.toBe(file);
		unsubscribe();
		vi.restoreAllMocks();
	});
});
