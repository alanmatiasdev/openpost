import { afterEach, describe, expect, it, vi } from 'vitest';
import { BufferTarget, Output, VideoSample, VideoSampleSource, WebMOutputFormat } from 'mediabunny';
import { filmstripCache, type Filmstrip } from './filmstrip-client';
import { loadFilmstrip } from './filmstrip-persistence';
import type { MediaMetadata } from './types';

function linkedFileHandle(name: string, file: File): FileSystemFileHandle {
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

async function sourceVideo(): Promise<File> {
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const source = new VideoSampleSource({ codec: 'vp8', bitrate: 200_000, keyFrameInterval: 1 });
	output.addVideoTrack(source, { frameRate: 2 });
	await output.start();
	const canvas = new OffscreenCanvas(320, 180);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable.');
	for (const [frame, color] of ['#dc2626', '#2563eb'].entries()) {
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
