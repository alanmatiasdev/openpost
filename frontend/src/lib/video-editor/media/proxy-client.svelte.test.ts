import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	Input,
	Output,
	VideoSample,
	VideoSampleSource,
	WebMOutputFormat
} from 'mediabunny';
import {
	cachedProxy,
	clearProxyCache,
	getAutomaticProxy,
	getProxy,
	PROXY_MAX_HEIGHT
} from './proxy-client';
import type { MediaMetadata } from './types';
import type { Project, TimelineItem } from '../project/types';
import { mediaPool } from './pool.svelte';
import { editorSession } from '../editor.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { previewPlaybackSettings } from '../preview/playback-settings.svelte';
import PreviewPlayer from '../components/preview-player.svelte';

const WIDTH = 1280;
const HEIGHT = 720;

function linkedFileHandle(name: string, getFile: () => Promise<File>): FileSystemFileHandle {
	const handle: FileSystemFileHandle = {
		kind: 'file',
		name,
		getFile,
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

afterEach(() => {
	mediaPool.clear();
	timelineStore.clear();
	sequenceStore.reset();
	editorSession.project = null;
});

async function sourceVideo(): Promise<Blob> {
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const source = new VideoSampleSource({
		codec: 'vp8',
		bitrate: 800_000,
		keyFrameInterval: 1
	});
	output.addVideoTrack(source, { frameRate: 2 });
	await output.start();
	const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable.');
	for (const [frame, color] of ['#ef4444', '#3b82f6'].entries()) {
		context.fillStyle = color;
		context.fillRect(0, 0, WIDTH, HEIGHT);
		const sample = new VideoSample(canvas, { timestamp: frame / 2, duration: 0.5 });
		await source.add(sample);
		sample.close();
	}
	source.close();
	await output.finalize();
	if (!target.buffer) throw new Error('Source render produced no bytes.');
	return new Blob([target.buffer], { type: 'video/webm' });
}

describe('proxy generation worker', () => {
	it('drops canceled background work before reading the source', async () => {
		const getFile = vi.fn(async () => {
			throw new Error('Canceled proxy work must not read its source.');
		});
		const controller = new AbortController();
		controller.abort();
		const media: MediaMetadata = {
			id: `canceled-proxy-${crypto.randomUUID()}`,
			storageType: 'handle',
			fileHandle: linkedFileHandle('unused.webm', getFile),
			fileName: 'unused.webm',
			fileSize: 1,
			mimeType: 'video/webm',
			duration: 1,
			width: WIDTH,
			height: HEIGHT,
			fps: 60,
			codec: 'vp8',
			bitrate: 800_000,
			tags: []
		};

		await expect(getAutomaticProxy(media, undefined, controller.signal)).rejects.toMatchObject({
			name: 'AbortError'
		});
		expect(getFile).not.toHaveBeenCalled();
	});

	it('decodes real footage off thread and returns a bounded playable proxy', async () => {
		const source = await sourceVideo();
		const progress = vi.fn();
		const media: MediaMetadata = {
			id: `proxy-worker-${crypto.randomUUID()}`,
			storageType: 'handle',
			fileHandle: linkedFileHandle(
				'source.webm',
				async () => new File([source], 'source.webm', { type: source.type })
			),
			fileName: 'source.webm',
			fileSize: source.size,
			mimeType: source.type,
			duration: 1,
			width: 3840,
			height: 2160,
			fps: 2,
			codec: 'vp8',
			bitrate: 800_000,
			tags: []
		};

		const proxy = await getProxy(media, progress);
		expect(proxy.type).toBe('video/webm');
		expect(proxy.size).toBeGreaterThan(0);
		expect(progress).toHaveBeenCalled();
		expect(cachedProxy(media.id)).toBe(proxy);
		expect(clearProxyCache(media.id)).toBe(true);
		expect(cachedProxy(media.id)).toBeNull();

		const input = new Input({ source: new BlobSource(proxy), formats: ALL_FORMATS });
		const track = await input.getPrimaryVideoTrack();
		expect(track).not.toBeNull();
		expect(track?.displayWidth).toBe(960);
		expect(track?.displayHeight).toBe(PROXY_MAX_HEIGHT);
		expect(await track?.computeDuration()).toBeGreaterThanOrEqual(0.5);

		const previewMedia = { ...media, id: `automatic-proxy-${crypto.randomUUID()}` };
		const item: TimelineItem = {
			id: 'heavy-clip',
			trackId: 'video',
			from: 0,
			durationInFrames: 30,
			label: 'Heavy clip',
			type: 'video',
			mediaId: previewMedia.id,
			sourceStart: 0,
			sourceEnd: 30,
			sourceDuration: 30,
			sourceFps: 30,
			transform: { width: WIDTH, height: HEIGHT }
		};
		const project: Project = {
			id: 'proxy-preview-project',
			name: 'Proxy preview',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 1,
			metadata: { width: WIDTH, height: HEIGHT, fps: 30, backgroundColor: '#000000' },
			timeline: {
				tracks: [
					{
						id: 'video',
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
				items: [item]
			}
		};
		mediaPool.upsert(previewMedia, 'ready');
		editorSession.project = project;
		timelineStore.setAll({ items: [item], tracks: project.timeline?.tracks, fps: 30 });
		previewPlaybackSettings.setPreviewQuality('auto');
		const screen = await render(PreviewPlayer, { onedit: vi.fn() });
		await vi.waitFor(() => {
			expect(screen.container.querySelector('video')?.dataset.proxyPreview).toBe('true');
			expect(screen.container.querySelector('audio')).not.toBeNull();
		});
		previewPlaybackSettings.setPreviewQuality('full');
		await vi.waitFor(() => {
			expect(screen.container.querySelector('video')?.dataset.proxyPreview).toBeUndefined();
			expect(screen.container.querySelector('audio')).toBeNull();
		});
	});
});
