import { afterEach, describe, expect, it } from 'vitest';
import { BufferTarget, Output, VideoSample, VideoSampleSource, WebMOutputFormat } from 'mediabunny';
import type { MediaMetadata } from '../media/types';
import {
	clearPreviewDecoderPrewarm,
	clonePrewarmedPreviewFrame,
	prewarmPreviewFrame
} from './decoder-prewarm-client';

const SIZE = 64;

async function twoFrameVideo(): Promise<Blob> {
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const source = new VideoSampleSource({ codec: 'vp8', bitrate: 300_000, keyFrameInterval: 1 });
	output.addVideoTrack(source, { frameRate: 2 });
	await output.start();
	const canvas = new OffscreenCanvas(SIZE, SIZE);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable.');
	for (const [frame, color] of ['#ef4444', '#3b82f6'].entries()) {
		context.fillStyle = color;
		context.fillRect(0, 0, SIZE, SIZE);
		const sample = new VideoSample(canvas, { timestamp: frame / 2, duration: 0.5 });
		await source.add(sample);
		sample.close();
	}
	source.close();
	await output.finalize();
	if (!target.buffer) throw new Error('Source render produced no bytes.');
	return new Blob([target.buffer], { type: 'video/webm' });
}

afterEach(() => clearPreviewDecoderPrewarm());

describe('preview decoder prewarm worker', () => {
	it('decodes and reuses the exact upcoming frame without UI-thread video playback', async () => {
		const blob = await twoFrameVideo();
		const media: MediaMetadata = {
			id: `prewarm-${crypto.randomUUID()}`,
			storageType: 'handle',
			fileName: 'two-frames.webm',
			fileSize: blob.size,
			mimeType: blob.type,
			duration: 1,
			width: SIZE,
			height: SIZE,
			fps: 2,
			codec: 'vp8',
			bitrate: 300_000,
			tags: ['video']
		};

		await prewarmPreviewFrame(media, 0.5, blob);
		const bitmap = await clonePrewarmedPreviewFrame(media.id, 0.5, 0.001);
		expect(bitmap).not.toBeNull();
		if (!bitmap) return;
		const { width, height } = bitmap;
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d');
		if (!context) throw new Error('2D canvas unavailable.');
		context.drawImage(bitmap, 0, 0);
		bitmap.close();
		const pixel = context.getImageData(width / 2, height / 2, 1, 1).data;
		expect(pixel[2]).toBeGreaterThan(180);
		expect(pixel[0]).toBeLessThan(100);
	});
});
