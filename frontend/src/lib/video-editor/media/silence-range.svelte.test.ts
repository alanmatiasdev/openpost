import { describe, expect, it } from 'vitest';
import { decodeAudioBlobRangeForAnalysis } from './silence';

function twoToneWave(): File {
	const sampleRate = 8_000;
	const durationSeconds = 4;
	const sampleCount = sampleRate * durationSeconds;
	const bytesPerSample = 2;
	const dataBytes = sampleCount * bytesPerSample;
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
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * bytesPerSample, true);
	view.setUint16(32, bytesPerSample, true);
	view.setUint16(34, bytesPerSample * 8, true);
	ascii(36, 'data');
	view.setUint32(40, dataBytes, true);
	for (let sample = 0; sample < sampleCount; sample += 1) {
		const seconds = sample / sampleRate;
		const frequency = seconds < 2 ? 220 : 880;
		const value = Math.sin(seconds * Math.PI * 2 * frequency);
		view.setInt16(44 + sample * bytesPerSample, Math.round(value * 24_000), true);
	}
	return new File([buffer], 'two-tone.wav', { type: 'audio/wav' });
}

function estimateFrequency(samples: Float32Array, sampleRate: number): number {
	let risingCrossings = 0;
	for (let index = 1; index < samples.length; index += 1) {
		if ((samples[index - 1] ?? 0) <= 0 && (samples[index] ?? 0) > 0) risingCrossings += 1;
	}
	return (risingCrossings * sampleRate) / samples.length;
}

describe('bounded audio analysis decode', () => {
	it('seeks to exact late source windows instead of decoding the whole file', async () => {
		const file = twoToneWave();
		const early = await decodeAudioBlobRangeForAnalysis(file, 0.5, 1);
		const late = await decodeAudioBlobRangeForAnalysis(file, 2.5, 3);

		expect(early.length).toBeLessThanOrEqual(early.sampleRate * 0.51);
		expect(late.length).toBeLessThanOrEqual(late.sampleRate * 0.51);
		expect(early.length).toBeGreaterThanOrEqual(early.sampleRate * 0.49);
		expect(late.length).toBeGreaterThanOrEqual(late.sampleRate * 0.49);
		expect(estimateFrequency(early.getChannelData(0), early.sampleRate)).toBeCloseTo(220, -1);
		expect(estimateFrequency(late.getChannelData(0), late.sampleRate)).toBeCloseTo(880, -1);
	});

	it('stops before opening a decoder when cancellation already won', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			decodeAudioBlobRangeForAnalysis(twoToneWave(), 2.5, 3, controller.signal)
		).rejects.toMatchObject({ name: 'AbortError' });
	});
});
