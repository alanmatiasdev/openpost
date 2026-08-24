import { afterEach, describe, expect, it } from 'vitest';
import {
	ALL_FORMATS,
	AudioSample,
	AudioSampleSource,
	BlobSource,
	BufferTarget,
	CanvasSink,
	EncodedPacketSink,
	Input,
	Mp4OutputFormat,
	Output,
	VideoSample,
	VideoSampleSource,
	WebMOutputFormat
} from 'mediabunny';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import type { MediaMetadata } from './types';
import { mediaPool } from './pool.svelte';
import { renderMultiTrackVideoArtifact } from './render-export';

const SIZE = 64;
const FPS = 2;
const COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#facc15'];

async function sourceVideo(): Promise<Blob> {
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const source = new VideoSampleSource({ codec: 'vp8', bitrate: 500_000, keyFrameInterval: 0.5 });
	const audioSource = new AudioSampleSource({ codec: 'opus', bitrate: 96_000 });
	output.addVideoTrack(source, { frameRate: FPS });
	output.addAudioTrack(audioSource);
	await output.start();
	const sampleRate = 48_000;
	const pcm = new Float32Array((COLORS.length / FPS) * sampleRate);
	for (let frame = 0; frame < pcm.length; frame++) {
		const seconds = frame / sampleRate;
		pcm[frame] = Math.sin(2 * Math.PI * (220 * seconds + 110 * seconds * seconds)) * 0.25;
	}
	const audioSample = new AudioSample({
		data: pcm,
		format: 'f32',
		numberOfChannels: 1,
		sampleRate,
		timestamp: 0
	});
	await audioSource.add(audioSample);
	audioSample.close();
	audioSource.close();
	const canvas = new OffscreenCanvas(SIZE, SIZE);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable.');
	for (let frame = 0; frame < COLORS.length; frame++) {
		context.fillStyle = COLORS[frame]!;
		context.fillRect(0, 0, SIZE, SIZE);
		const sample = new VideoSample(canvas, { timestamp: frame / FPS, duration: 1 / FPS });
		await source.add(sample);
		sample.close();
	}
	source.close();
	await output.finalize();
	if (!target.buffer) throw new Error('Source render produced no bytes.');
	return new Blob([target.buffer], { type: 'video/webm' });
}

async function avcSourceVideo(): Promise<Blob> {
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat(), target });
	const source = new VideoSampleSource({ codec: 'avc', bitrate: 500_000, keyFrameInterval: 0.5 });
	output.addVideoTrack(source, { frameRate: FPS });
	await output.start();
	const canvas = new OffscreenCanvas(SIZE, SIZE);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable.');
	for (let frame = 0; frame < COLORS.length; frame++) {
		context.fillStyle = COLORS[frame]!;
		context.fillRect(0, 0, SIZE, SIZE);
		const sample = new VideoSample(canvas, { timestamp: frame / FPS, duration: 1 / FPS });
		await source.add(sample);
		sample.close();
	}
	source.close();
	await output.finalize();
	if (!target.buffer) throw new Error('AVC source render produced no bytes.');
	return new Blob([target.buffer], { type: 'video/mp4' });
}

async function packets(blob: Blob): Promise<Array<{ timestamp: number; data: number[] }>> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error('Video track missing.');
		const result: Array<{ timestamp: number; data: number[] }> = [];
		for await (const packet of new EncodedPacketSink(track).packets()) {
			result.push({ timestamp: packet.timestamp, data: [...packet.data] });
		}
		return result;
	} finally {
		input.dispose();
	}
}

async function audioPackets(
	blob: Blob
): Promise<Array<{ timestamp: number; duration: number; data: number[] }>> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error('Audio track missing.');
		const result: Array<{ timestamp: number; duration: number; data: number[] }> = [];
		for await (const packet of new EncodedPacketSink(track).packets()) {
			result.push({
				timestamp: packet.timestamp,
				duration: packet.duration,
				data: [...packet.data]
			});
		}
		return result;
	} finally {
		input.dispose();
	}
}

async function centerPixel(blob: Blob, seconds: number): Promise<[number, number, number]> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error('Video track missing.');
		const wrapped = await new CanvasSink(track).getCanvas(seconds);
		if (!wrapped) throw new Error('Decoded frame missing.');
		const context = wrapped.canvas.getContext('2d');
		if (!context) throw new Error('2D canvas unavailable.');
		const pixel = context.getImageData(SIZE / 2, SIZE / 2, 1, 1).data;
		return [pixel[0]!, pixel[1]!, pixel[2]!];
	} finally {
		input.dispose();
	}
}

function expectColor(actual: [number, number, number], expected: [number, number, number]): void {
	for (let channel = 0; channel < 3; channel++) {
		expect(Math.abs(actual[channel]! - expected[channel]!)).toBeLessThan(18);
	}
}

async function packetDigests(packets: Array<{ data: number[] }>): Promise<string[]> {
	return Promise.all(
		packets.map(async (packet) => {
			const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(packet.data));
			return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
				''
			);
		})
	);
}

function countOccurrences(haystack: Uint8Array, needle: Uint8Array): number {
	let count = 0;
	for (let offset = 0; offset <= haystack.length - needle.length; offset++) {
		let matches = true;
		for (let index = 0; index < needle.length; index++) {
			if (haystack[offset + index] !== needle[index]) {
				matches = false;
				break;
			}
		}
		if (matches) {
			count += 1;
			offset += needle.length - 1;
		}
	}
	return count;
}

describe('smartCopy', () => {
	afterEach(() => mediaPool.clear());

	it('routes export through byte-identical packet copy and decodes the exact range', async () => {
		const sourceBlob = await sourceVideo();
		const sourceFile = new File([sourceBlob], 'source.webm', { type: 'video/webm' });
		// SAFETY: the packet-copy path only calls getFile on this test handle.
		const media: MediaMetadata = {
			id: 'source',
			storageType: 'handle',
			fileHandle: { getFile: async () => sourceFile } as FileSystemFileHandle,
			fileName: sourceFile.name,
			fileSize: sourceFile.size,
			mimeType: sourceFile.type,
			duration: COLORS.length / FPS,
			width: SIZE,
			height: SIZE,
			fps: FPS,
			codec: 'vp8',
			audioCodec: 'opus',
			bitrate: 500_000,
			keyframeTimestamps: [0, 0.5, 1, 1.5],
			tags: ['video']
		};
		mediaPool.upsert(media, 'ready');
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
		const item: TimelineItem = {
			id: 'clip',
			trackId: track.id,
			from: 0,
			durationInFrames: 4,
			label: 'Source',
			type: 'video',
			mediaId: media.id,
			sourceStart: 0,
			sourceEnd: 4,
			sourceDuration: 4,
			sourceFps: FPS,
			sourceWidth: SIZE,
			sourceHeight: SIZE,
			transform: { width: SIZE, height: SIZE }
		};
		const project: Project = {
			id: 'packet-copy',
			name: 'Packet copy',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 2,
			metadata: { width: SIZE, height: SIZE, fps: FPS },
			timeline: { tracks: [track], items: [item], transitions: [] }
		};

		const sourceAudioPackets = await audioPackets(sourceBlob);
		const closestAudioStart = sourceAudioPackets.reduce((closest, packet) =>
			Math.abs(packet.timestamp - 0.5) < Math.abs(closest.timestamp - 0.5) ? packet : closest
		);
		const selectedSourceAudioPackets = sourceAudioPackets.filter(
			(packet) =>
				packet.timestamp >= closestAudioStart.timestamp &&
				packet.timestamp < closestAudioStart.timestamp + 1
		);

		const selectedDigests = await packetDigests(selectedSourceAudioPackets);
		const expectedByDigest = new Map<
			string,
			{ count: number; data: Uint8Array; timestamp: number }
		>();
		for (let index = 0; index < selectedDigests.length; index++) {
			const digest = selectedDigests[index]!;
			const current = expectedByDigest.get(digest);
			expectedByDigest.set(digest, {
				count: (current?.count ?? 0) + 1,
				data: current?.data ?? new Uint8Array(selectedSourceAudioPackets[index]!.data),
				timestamp: current?.timestamp ?? selectedSourceAudioPackets[index]!.timestamp
			});
		}
		const sourcePackets = await packets(sourceBlob);
		for (const format of ['webm', 'mkv'] as const) {
			const copied = await renderMultiTrackVideoArtifact(project, {
				format,
				codec: 'vp8',
				width: SIZE,
				height: SIZE,
				range: { startFrame: 1, endFrame: 3 },
				subtitleMode: 'none'
			});
			const copiedPackets = await packets(copied.blob);
			expect(copied.fileName).toBe(`Packet copy.${format}`);
			expect(copied.renderMethod).toBe('smart-copy');
			expect(copiedPackets.map((packet) => packet.timestamp)).toEqual([0, 0.5]);
			expect(copiedPackets.map((packet) => packet.data)).toEqual(
				sourcePackets.slice(1, 3).map((packet) => packet.data)
			);
			const copiedBytes = new Uint8Array(await copied.blob.arrayBuffer());
			for (const expected of expectedByDigest.values()) {
				expect(
					countOccurrences(copiedBytes, expected.data),
					`${format} audio packet at ${expected.timestamp}s`
				).toBeGreaterThanOrEqual(expected.count);
			}
			expectColor(await centerPixel(copied.blob, 0), [34, 197, 94]);
			expectColor(await centerPixel(copied.blob, 0.5), [59, 130, 246]);
		}
	});

	it('copies AVC packets unchanged into MP4 and MOV containers', async () => {
		const sourceBlob = await avcSourceVideo();
		const sourceFile = new File([sourceBlob], 'source.mp4', { type: 'video/mp4' });
		// SAFETY: the packet-copy path only calls getFile on this test handle.
		const media: MediaMetadata = {
			id: 'avc-source',
			storageType: 'handle',
			fileHandle: { getFile: async () => sourceFile } as FileSystemFileHandle,
			fileName: sourceFile.name,
			fileSize: sourceFile.size,
			mimeType: sourceFile.type,
			duration: COLORS.length / FPS,
			width: SIZE,
			height: SIZE,
			fps: FPS,
			codec: 'avc',
			bitrate: 500_000,
			keyframeTimestamps: [0, 0.5, 1, 1.5],
			tags: ['video']
		};
		mediaPool.upsert(media, 'ready');
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
		const project: Project = {
			id: 'avc-copy',
			name: 'AVC copy',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 2,
			metadata: { width: SIZE, height: SIZE, fps: FPS },
			timeline: {
				tracks: [track],
				items: [
					{
						id: 'clip',
						trackId: track.id,
						from: 0,
						durationInFrames: 4,
						label: 'AVC source',
						type: 'video',
						mediaId: media.id,
						sourceStart: 0,
						sourceEnd: 4,
						sourceDuration: 4,
						sourceFps: FPS,
						sourceWidth: SIZE,
						sourceHeight: SIZE,
						transform: { width: SIZE, height: SIZE }
					}
				],
				transitions: []
			}
		};
		const sourcePackets = await packets(sourceBlob);
		for (const format of ['mp4', 'mov'] as const) {
			const copied = await renderMultiTrackVideoArtifact(project, {
				format,
				codec: 'avc',
				width: SIZE,
				height: SIZE,
				range: { startFrame: 1, endFrame: 3 },
				subtitleMode: 'none'
			});
			const copiedPackets = await packets(copied.blob);
			expect(copied.renderMethod).toBe('smart-copy');
			expect(copiedPackets.map((packet) => packet.data)).toEqual(
				sourcePackets.slice(1, 3).map((packet) => packet.data)
			);
			expectColor(await centerPixel(copied.blob, 0), [34, 197, 94]);
			expectColor(await centerPixel(copied.blob, 0.5), [59, 130, 246]);
		}
	});
});
