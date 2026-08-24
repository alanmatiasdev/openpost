import { describe, expect, it, vi } from 'vitest';
import { clearWaveformCache, getWaveform } from './waveform-client';
import { loadWaveform } from './waveform-persistence';
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

function sourceWave(): File {
	const sampleRate = 8_000;
	const sampleCount = sampleRate / 2;
	const channelCount = 1;
	const bytesPerSample = 2;
	const dataBytes = sampleCount * channelCount * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataBytes);
	const view = new DataView(buffer);
	const ascii = (offset: number, value: string) => {
		for (let index = 0; index < value.length; index += 1) {
			view.setUint8(offset + index, value.charCodeAt(index));
		}
	};
	ascii(0, 'RIFF');
	view.setUint32(4, 36 + dataBytes, true);
	ascii(8, 'WAVE');
	ascii(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, channelCount, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
	view.setUint16(32, channelCount * bytesPerSample, true);
	view.setUint16(34, bytesPerSample * 8, true);
	ascii(36, 'data');
	view.setUint32(40, dataBytes, true);
	for (let sample = 0; sample < sampleCount; sample += 1) {
		const value = Math.sin((sample / sampleRate) * 2 * Math.PI * 440);
		view.setInt16(44 + sample * bytesPerSample, Math.round(value * 24_000), true);
	}
	return new File([buffer], 'waveform-source.wav', { type: 'audio/wav' });
}

describe('waveform cache maintenance', () => {
	it('removes decoded memory and OPFS peaks without touching the source', async () => {
		const file = sourceWave();
		const id = `waveform-clear-${crypto.randomUUID()}`;
		const media: MediaMetadata = {
			id,
			storageType: 'handle',
			fileHandle: linkedFileHandle(file.name, file),
			fileName: file.name,
			fileSize: file.size,
			mimeType: file.type,
			duration: 0.5,
			width: 0,
			height: 0,
			fps: 0,
			codec: 'pcm_s16le',
			bitrate: 128_000,
			tags: ['audio']
		};

		const generated = await getWaveform(media);
		expect(generated.peaks.length).toBeGreaterThan(0);
		expect(Math.max(...generated.peaks)).toBeGreaterThan(0.5);
		await vi.waitFor(async () => {
			expect((await loadWaveform(id))?.peaks.length).toBe(generated.peaks.length);
		});

		await clearWaveformCache(id);

		expect(await loadWaveform(id)).toBeNull();
		await expect(media.fileHandle?.getFile()).resolves.toBe(file);
	});
});
