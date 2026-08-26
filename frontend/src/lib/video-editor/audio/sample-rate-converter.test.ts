import { describe, expect, it } from 'vitest';
import {
	AbsolutePhaseResampler,
	downmixToOutputChannels,
	expectedOutputFrames,
	resampleAudioChannels,
	resampleChannelLinear
} from './sample-rate-converter';

function sine(freq: number, frames: number, rate: number): Float32Array {
	return Float32Array.from({ length: frames }, (_, i) => Math.sin((2 * Math.PI * freq * i) / rate));
}

function peakFreq(signal: Float32Array, rate: number): number {
	// crude zero-crossing estimator for pure sine
	let crossings = 0;
	for (let i = 1; i < signal.length; i++) if (signal[i - 1]! < 0 && signal[i]! >= 0) crossings++;
	const duration = signal.length / rate;
	return crossings / duration;
}

describe('sample-rate-converter', () => {
	it('keeps 44.1k to 48k tone at correct pitch', () => {
		const input = sine(440, 44_100, 44_100);
		const out = resampleChannelLinear(input, 44_100, 48_000);
		expect(out.length).toBe(expectedOutputFrames(input.length, 44_100, 48_000));
		const freq = peakFreq(out, 48_000);
		expect(Math.abs(freq - 440)).toBeLessThan(5);
	});

	it('matches single-shot vs chunked resample across boundaries', () => {
		const rateIn = 44_100;
		const rateOut = 48_000;
		const frames = 100_000;
		const impulseAt = 50_000;
		const input = new Float32Array(frames);
		input[impulseAt] = 1;
		const single = resampleChannelLinear(input, rateIn, rateOut);
		const resampler = new AbsolutePhaseResampler(rateIn, rateOut);
		const chunkSize = 4096;
		const chunks: Float32Array[] = [];
		for (let off = 0; off < input.length; off += chunkSize)
			chunks.push(input.subarray(off, off + chunkSize));
		const chunkedParts: Float32Array[] = [];
		for (let i = 0; i < chunks.length; i++)
			chunkedParts.push(resampler.processChunk(chunks[i]!, i === chunks.length - 1));
		const chunkedLen = chunkedParts.reduce((s, p) => s + p.length, 0);
		const chunked = new Float32Array(chunkedLen);
		let o = 0;
		for (const p of chunkedParts) {
			chunked.set(p, o);
			o += p.length;
		}
		expect(chunked.length).toBe(single.length);
		// impulse should land within one sample across boundary
		const singlePeak = single.indexOf(Math.max(...single));
		const chunkedPeak = chunked.indexOf(Math.max(...chunked));
		expect(Math.abs(singlePeak - chunkedPeak)).toBeLessThanOrEqual(1);
		expect(chunked[singlePeak] ?? 0).toBeCloseTo(single[singlePeak] ?? 0, 2);
	});

	it('has zero cumulative drift over long duration', () => {
		const rateIn = 44_100;
		const rateOut = 48_000;
		const seconds = 600; // 10 minutes
		const inputFrames = seconds * rateIn;
		const expected = seconds * rateOut;
		expect(expectedOutputFrames(inputFrames, rateIn, rateOut)).toBe(expected);
		// chunked accumulation also exact
		const chunkFrames = 4096;
		const resampler = new AbsolutePhaseResampler(rateIn, rateOut);
		let total = 0;
		const dummy = new Float32Array(chunkFrames);
		for (let seen = 0; seen < inputFrames; seen += chunkFrames) {
			const size = Math.min(chunkFrames, inputFrames - seen);
			const chunk = dummy.subarray(0, size);
			const out = resampler.processChunk(chunk, seen + size >= inputFrames);
			total += out.length;
		}
		expect(total).toBe(expected);
		// naive per-chunk floor would drift
		let naive = 0;
		for (let seen = 0; seen < inputFrames; seen += chunkFrames) {
			const size = Math.min(chunkFrames, inputFrames - seen);
			naive += Math.floor((size * rateOut) / rateIn);
		}
		expect(naive).not.toBe(expected);
		expect(Math.abs(naive - expected)).toBeGreaterThan(10);
	});

	it('handles common rates without drift: 22.05, 32, 44.1, 48 to 48', () => {
		for (const src of [22_050, 32_000, 44_100, 48_000]) {
			const input = sine(1000, src, src);
			const out = resampleAudioChannels([input], src, 48_000)[0]!;
			expect(out.length).toBe(expectedOutputFrames(src, src, 48_000));
			const freq = peakFreq(out, 48_000);
			expect(Math.abs(freq - 1000)).toBeLessThan(5);
		}
	});

	it('maps mono to stereo by duplication and 5.1 via ITU', () => {
		const mono = new Float32Array([0.5, 0.6]);
		const stereoFromMono = downmixToOutputChannels([mono], 2);
		expect(stereoFromMono).toHaveLength(2);
		expect(stereoFromMono[0]!).toEqual(mono);
		expect(stereoFromMono[1]!).toEqual(mono);

		const L = new Float32Array([1, 0]);
		const R = new Float32Array([0, 1]);
		const C = new Float32Array([1, 1]);
		const LFE = new Float32Array([99, 99]);
		const Ls = new Float32Array([0.5, 0]);
		const Rs = new Float32Array([0, 0.5]);
		const stereo = downmixToOutputChannels([L, R, C, LFE, Ls, Rs], 2);
		// Lo = L + 0.707*C + 0.707*Ls
		expect(stereo[0]![0]).toBeCloseTo(1 + 0.7071068 * 1 + 0.7071068 * 0.5, 4);
		expect(stereo[1]![0]).toBeCloseTo(0 + 0.7071068 * 1, 4);
		// LFE dropped
		expect(stereo[0]![1]).toBeCloseTo(0 + 0.7071068 * 1, 4);
	});
});
