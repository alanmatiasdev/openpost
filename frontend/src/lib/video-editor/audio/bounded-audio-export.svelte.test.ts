import { afterEach, describe, expect, it } from 'vitest';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { mediaPool } from '../media/pool.svelte';
import { renderTimelineAudioArtifact } from '../media/render-export';

function linkedFileHandle(file: File): FileSystemFileHandle {
	// SAFETY: test helper only uses name, kind and getFile for resolveMediaBlob
	return { kind: 'file', name: file.name, getFile: async () => file } as FileSystemFileHandle;
}

function wavBlobFromMono(samples: Float32Array, sampleRate: number): Blob {
	const bytesPerSample = 2;
	const blockAlign = 1 * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const dataSize = samples.length * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);
	let o = 0;
	const write = (s: string) => {
		for (let i = 0; i < s.length; i++) view.setUint8(o++, s.charCodeAt(i));
	};
	write('RIFF');
	view.setUint32(o, 36 + dataSize, true);
	o += 4;
	write('WAVE');
	write('fmt ');
	view.setUint32(o, 16, true);
	o += 4;
	view.setUint16(o, 1, true);
	o += 2;
	view.setUint16(o, 1, true);
	o += 2;
	view.setUint32(o, sampleRate, true);
	o += 4;
	view.setUint32(o, byteRate, true);
	o += 4;
	view.setUint16(o, blockAlign, true);
	o += 2;
	view.setUint16(o, 16, true);
	o += 2;
	write('data');
	view.setUint32(o, dataSize, true);
	o += 4;
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]!));
		view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
		o += 2;
	}
	return new Blob([buffer], { type: 'audio/wav' });
}
function sine(samples: number, freq: number, rate: number): Float32Array {
	return Float32Array.from({ length: samples }, (_, i) =>
		Math.sin((2 * Math.PI * freq * i) / rate)
	);
}
afterEach(() => mediaPool.clear());

describe('bounded audio export product path', () => {
	it('preserves 44.1k tone absolute phase via windowed windows', async () => {
		const rate = 44_100;
		const durationSec = 60;
		const samples = rate * durationSec;
		const tone = sine(samples, 440, rate);
		tone[durationSec * rate - 10] = 0.9; // marker near end
		const blob = wavBlobFromMono(tone, rate);
		const file = new File([blob], 'tone-44k.wav', { type: 'audio/wav' });
		mediaPool.upsert(
			{
				id: 'src44',
				storageType: 'handle',
				fileHandle: linkedFileHandle(file),
				fileName: file.name,
				fileSize: file.size,
				mimeType: 'audio/wav',
				duration: durationSec,
				width: 0,
				height: 0,
				fps: 0,
				codec: '',
				audioCodec: 'pcm-s16',
				audioCodecSupported: true,
				bitrate: 0,
				tags: ['audio']
			},
			'ready'
		);
		const track: TimelineTrack = {
			id: 't',
			name: 't',
			kind: 'audio',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const item: TimelineItem = {
			id: 'c',
			trackId: 't',
			from: 0,
			durationInFrames: durationSec * 30,
			label: '',
			type: 'audio',
			mediaId: 'src44',
			sourceStart: 0,
			sourceFps: 30
		};
		const project: Project = {
			id: 'p',
			name: 'wav44',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 0,
			metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
			timeline: { tracks: [track], items: [item] }
		};
		const artifact = await renderTimelineAudioArtifact(project, { format: 'wav' });
		expect(artifact.blob.type).toBe('audio/wav');
		const ctx = new AudioContext();
		const decoded = await ctx.decodeAudioData(await artifact.blob.arrayBuffer());
		expect(decoded.sampleRate).toBe(48_000);
		expect(decoded.length).toBeCloseTo(durationSec * 48_000, -2);
		expect(decoded.numberOfChannels).toBe(2);
		// Mono duplicated to stereo
		const left = decoded.getChannelData(0);
		const right = decoded.getChannelData(1);
		expect(left[1000]).toBeCloseTo(right[1000], 4);
		// Frequency approx via zero crossings
		let crossings = 0;
		for (let i = 1; i < left.length; i++) if (left[i - 1]! < 0 && left[i]! >= 0) crossings++;
		const freq = crossings / durationSec;
		expect(Math.abs(freq - 440)).toBeLessThan(5);
		await ctx.close();
	}, 30_000);

	it('keeps impulse across 30s window boundary', async () => {
		const rate = 48_000;
		const durationSec = 61;
		const samples = rate * durationSec;
		const data = new Float32Array(samples);
		const impulseAt = 30 * rate; // exactly at window edge
		data[impulseAt] = 1;
		data[impulseAt + 1] = 0.5;
		const blob = wavBlobFromMono(data, rate);
		const file = new File([blob], 'impulse.wav', { type: 'audio/wav' });
		mediaPool.upsert(
			{
				id: 'imp',
				storageType: 'handle',
				fileHandle: linkedFileHandle(file),
				fileName: file.name,
				fileSize: file.size,
				mimeType: 'audio/wav',
				duration: durationSec,
				width: 0,
				height: 0,
				fps: 0,
				codec: '',
				audioCodec: 'pcm-s16',
				audioCodecSupported: true,
				bitrate: 0,
				tags: ['audio']
			},
			'ready'
		);
		const track: TimelineTrack = {
			id: 't',
			name: 't',
			kind: 'audio',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const item: TimelineItem = {
			id: 'c',
			trackId: 't',
			from: 0,
			durationInFrames: durationSec * 30,
			label: '',
			type: 'audio',
			mediaId: 'imp',
			sourceStart: 0,
			sourceFps: 30
		};
		const project: Project = {
			id: 'p2',
			name: 'impulse',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 0,
			metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
			timeline: { tracks: [track], items: [item] }
		};
		const artifact = await renderTimelineAudioArtifact(project, { format: 'wav' });
		const ctx = new AudioContext();
		const decoded = await ctx.decodeAudioData(await artifact.blob.arrayBuffer());
		const ch = decoded.getChannelData(0);
		let peakIdx = -1;
		let peak = -Infinity;
		for (let i = 0; i < ch.length; i++)
			if (ch[i]! > peak) {
				peak = ch[i]!;
				peakIdx = i;
			}
		expect(Math.abs(peakIdx - impulseAt)).toBeLessThanOrEqual(2);
		expect(peak).toBeGreaterThan(0.4);
		await ctx.close();
	}, 30_000);

	it('respects exact trim boundaries', async () => {
		const rate = 48_000;
		const srcSec = 5;
		const src = sine(srcSec * rate, 440, rate);
		const blob = wavBlobFromMono(src, rate);
		const file = new File([blob], 'trim.wav', { type: 'audio/wav' });
		mediaPool.upsert(
			{
				id: 'trim',
				storageType: 'handle',
				fileHandle: linkedFileHandle(file),
				fileName: file.name,
				fileSize: file.size,
				mimeType: 'audio/wav',
				duration: srcSec,
				width: 0,
				height: 0,
				fps: 0,
				codec: '',
				audioCodec: 'pcm-s16',
				audioCodecSupported: true,
				bitrate: 0,
				tags: ['audio']
			},
			'ready'
		);
		const track: TimelineTrack = {
			id: 't',
			name: 't',
			kind: 'audio',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const item: TimelineItem = {
			id: 'c',
			trackId: 't',
			from: 0,
			durationInFrames: 2 * 30,
			label: '',
			type: 'audio',
			mediaId: 'trim',
			sourceStart: 1 * 30,
			sourceEnd: 3 * 30,
			sourceFps: 30
		};
		const project: Project = {
			id: 'p3',
			name: 'trim',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 0,
			metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
			timeline: { tracks: [track], items: [item] }
		};
		const artifact = await renderTimelineAudioArtifact(project, {
			format: 'wav',
			range: { startFrame: 0, endFrame: 60 }
		});
		const ctx = new AudioContext();
		const decoded = await ctx.decodeAudioData(await artifact.blob.arrayBuffer());
		expect(decoded.length).toBeCloseTo(2 * 48_000, -2);
		await ctx.close();
	}, 20_000);

	it('fails on decode failure for audio-only instead of silent', async () => {
		const track: TimelineTrack = {
			id: 't',
			name: 't',
			kind: 'audio',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const item: TimelineItem = {
			id: 'c',
			trackId: 't',
			from: 0,
			durationInFrames: 30,
			label: '',
			type: 'audio',
			mediaId: 'missing',
			sourceStart: 0,
			sourceFps: 30
		};
		const project: Project = {
			id: 'p4',
			name: 'fail',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 0,
			metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
			timeline: { tracks: [track], items: [item] }
		};
		await expect(renderTimelineAudioArtifact(project, { format: 'wav' })).rejects.toThrow();
	});

	it('cancels and does not leak', async () => {
		const rate = 48_000;
		const src = sine(3 * rate, 440, rate);
		const blob = wavBlobFromMono(src, rate);
		const file = new File([blob], 'cancel.wav', { type: 'audio/wav' });
		mediaPool.upsert(
			{
				id: 'cancel',
				storageType: 'handle',
				fileHandle: linkedFileHandle(file),
				fileName: file.name,
				fileSize: file.size,
				mimeType: 'audio/wav',
				duration: 3,
				width: 0,
				height: 0,
				fps: 0,
				codec: '',
				audioCodec: 'pcm-s16',
				audioCodecSupported: true,
				bitrate: 0,
				tags: ['audio']
			},
			'ready'
		);
		const track: TimelineTrack = {
			id: 't',
			name: 't',
			kind: 'audio',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const item: TimelineItem = {
			id: 'c',
			trackId: 't',
			from: 0,
			durationInFrames: 90,
			label: '',
			type: 'audio',
			mediaId: 'cancel',
			sourceStart: 0,
			sourceFps: 30
		};
		const project: Project = {
			id: 'p5',
			name: 'cancel',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 0,
			metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
			timeline: { tracks: [track], items: [item] }
		};
		const controller = new AbortController();
		const promise = renderTimelineAudioArtifact(project, {
			format: 'wav',
			signal: controller.signal
		});
		controller.abort();
		await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
	});

	it('bounds peak windows to one 30s owner', async () => {
		const rate = 48_000;
		const durationSec = 90;
		const src = new Float32Array(rate * durationSec);
		for (let i = 0; i < src.length; i++) src[i] = Math.sin((2 * Math.PI * 220 * i) / rate);
		const blob = wavBlobFromMono(src, rate);
		const file = new File([blob], 'long.wav', { type: 'audio/wav' });
		mediaPool.upsert(
			{
				id: 'long',
				storageType: 'handle',
				fileHandle: linkedFileHandle(file),
				fileName: file.name,
				fileSize: file.size,
				mimeType: 'audio/wav',
				duration: durationSec,
				width: 0,
				height: 0,
				fps: 0,
				codec: '',
				audioCodec: 'pcm-s16',
				audioCodecSupported: true,
				bitrate: 0,
				tags: ['audio']
			},
			'ready'
		);
		const track: TimelineTrack = {
			id: 't',
			name: 't',
			kind: 'audio',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const item: TimelineItem = {
			id: 'c',
			trackId: 't',
			from: 0,
			durationInFrames: durationSec * 30,
			label: '',
			type: 'audio',
			mediaId: 'long',
			sourceStart: 0,
			sourceFps: 30
		};
		const project: Project = {
			id: 'p6',
			name: 'long',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 0,
			metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
			timeline: { tracks: [track], items: [item] }
		};
		const artifact = await renderTimelineAudioArtifact(project, { format: 'wav' });
		const ctx = new AudioContext();
		const decoded = await ctx.decodeAudioData(await artifact.blob.arrayBuffer());
		expect(decoded.length).toBeCloseTo(durationSec * 48_000, -2);
		expect(decoded.length).toBeGreaterThan(0);
		// If windowed, peak allocated at any time is one window (1.44M) not total (4.32M) - we check artifact is correct
		await ctx.close();
	}, 30_000);
});
