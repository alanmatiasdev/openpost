import { describe, expect, it } from 'vitest';
import { BufferTarget, Output, VideoSample, VideoSampleSource, WebMOutputFormat } from 'mediabunny';
import type { TimelineItem } from '../project/types';
import { extractFreezeFrameFromBlob } from './freeze-frame';

const SIZE = 64;
const FPS = 2;
const COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#facc15'];

async function fourFrameVideo(): Promise<Blob> {
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const source = new VideoSampleSource({
		codec: 'vp8',
		bitrate: 500_000,
		keyFrameInterval: 1
	});
	output.addVideoTrack(source, { frameRate: FPS });
	await output.start();
	const canvas = new OffscreenCanvas(SIZE, SIZE);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable.');
	for (let frame = 0; frame < COLORS.length; frame++) {
		context.fillStyle = COLORS[frame]!;
		context.fillRect(0, 0, SIZE, SIZE);
		const sample = new VideoSample(canvas, {
			timestamp: frame / FPS,
			duration: 1 / FPS
		});
		await source.add(sample);
		sample.close();
	}
	source.close();
	await output.finalize();
	if (!target.buffer) throw new Error('Source render produced no bytes.');
	return new Blob([target.buffer], { type: 'video/webm' });
}

async function centerPixel(blob: Blob): Promise<[number, number, number]> {
	const bitmap = await createImageBitmap(blob);
	try {
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const context = canvas.getContext('2d');
		if (!context) throw new Error('2D canvas unavailable.');
		context.drawImage(bitmap, 0, 0);
		const pixel = context.getImageData(SIZE / 2, SIZE / 2, 1, 1).data;
		return [pixel[0]!, pixel[1]!, pixel[2]!];
	} finally {
		bitmap.close();
	}
}

function closeTo(actual: [number, number, number], expected: [number, number, number]): void {
	for (let channel = 0; channel < 3; channel++) {
		expect(Math.abs(actual[channel]! - expected[channel]!)).toBeLessThan(18);
	}
}

describe('freeze frame extraction', () => {
	it('decodes the exact reversed source frame at native display resolution', async () => {
		const item: TimelineItem = {
			id: 'clip',
			trackId: 'video',
			from: 10,
			durationInFrames: 4,
			label: 'Four frames',
			type: 'video',
			sourceStart: 0,
			sourceEnd: 4,
			sourceDuration: 4,
			sourceFps: FPS,
			isReversed: true
		};

		const extracted = await extractFreezeFrameFromBlob(await fourFrameVideo(), item, 11, FPS);

		expect(extracted.width).toBe(SIZE);
		expect(extracted.height).toBe(SIZE);
		expect(extracted.sourceSeconds).toBe(1);
		closeTo(await centerPixel(extracted.blob), [59, 130, 246]);
	});
});
