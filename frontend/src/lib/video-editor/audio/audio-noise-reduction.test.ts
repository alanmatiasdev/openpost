import { describe, expect, it } from 'vitest';
import {
	applyNoiseReduction,
	clampNoiseReductionAmount,
	isNoiseReductionActive,
	resolveNoiseReductionSettings,
	StreamingNoiseReduction
} from './audio-noise-reduction';
import { processAudioChannels } from './process-audio';
import { resolveAudioEqSettings } from './audio-eq';

function sine(freq: number, frames = 48000, sr = 48000, amp = 0.5): Float32Array {
	return Float32Array.from(
		{ length: frames },
		(_, i) => Math.sin(2 * Math.PI * freq * (i / sr)) * amp
	);
}

function whiteNoise(frames: number, amp = 0.15, seed = 1): Float32Array {
	const out = new Float32Array(frames);
	let s = seed;
	for (let i = 0; i < frames; i++) {
		s = (s * 1664525 + 1013904223) >>> 0;
		out[i] = ((s / 4294967296) * 2 - 1) * amp;
	}
	return out;
}

function add(a: Float32Array, b: Float32Array): Float32Array {
	const out = new Float32Array(a.length);
	for (let i = 0; i < a.length; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
	return out;
}
function rms(a: Float32Array): number {
	return Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
}
function snr(clean: Float32Array, test: Float32Array): number {
	let sig = 0;
	let noise = 0;
	for (let i = 0; i < clean.length; i++) {
		const c = clean[i] ?? 0;
		const e = (test[i] ?? 0) - c;
		sig += c * c;
		noise += e * e;
	}
	return 10 * Math.log10((sig + 1e-12) / (noise + 1e-12));
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
	let max = 0;
	for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
	return max;
}

function streamingWithChunks(
	input: Float32Array,
	chunkSizes: number[],
	sampleRate = 48000,
	amount = 60
): Float32Array {
	const proc = new StreamingNoiseReduction(1, sampleRate, { enabled: true, amount });
	const parts: Float32Array[] = [];
	let offset = 0;
	for (let i = 0; i < chunkSizes.length; i++) {
		const size = chunkSizes[i]!;
		const chunk = input.slice(offset, offset + size);
		const isLast = offset + size >= input.length;
		const out = proc.process([chunk], isLast)[0]!;
		parts.push(out);
		offset += size;
		if (isLast) break;
	}
	// If chunkSizes didn't cover all, flush remainder
	if (offset < input.length) {
		const remaining = input.slice(offset);
		const out = proc.process([remaining], true)[0]!;
		parts.push(out);
	}
	const total = parts.reduce((sum, p) => sum + p.length, 0);
	const out = new Float32Array(total);
	let pos = 0;
	for (const p of parts) {
		out.set(p, pos);
		pos += p.length;
	}
	return out;
}

describe('audio noise reduction - signal truth', () => {
	it('clamps amount and resolves defaults', () => {
		expect(clampNoiseReductionAmount(999)).toBe(100);
		expect(clampNoiseReductionAmount(-5)).toBe(0);
		expect(resolveNoiseReductionSettings(null).enabled).toBe(false);
		expect(
			resolveNoiseReductionSettings({
				audioNoiseReductionEnabled: true,
				audioNoiseReductionAmount: 73
			}).amount
		).toBe(73);
		expect(isNoiseReductionActive({ enabled: true, amount: 0 })).toBe(false);
		expect(isNoiseReductionActive({ enabled: true, amount: 30 })).toBe(true);
	});

	it('does not change length and is bypassed when disabled', () => {
		const ch = sine(440, 4800);
		const out = applyNoiseReduction([ch], 48000, { enabled: false, amount: 80 });
		expect(out[0]!.length).toBe(ch.length);
		expect(out[0]).not.toBe(ch);
		for (let i = 0; i < ch.length; i++) expect(out[0]![i]).toBe(ch[i]);
	});

	it('reduces hiss and improves SNR vs clean truth', () => {
		const clean = sine(1000, 48000, 48000, 0.4);
		const noise = whiteNoise(48000, 0.18, 42);
		const noisy = add(clean, noise);
		const beforeSnr = snr(clean, noisy);
		const out = applyNoiseReduction([noisy], 48000, { enabled: true, amount: 75 });
		const afterSnr = snr(clean, out[0]!);
		expect(afterSnr).toBeGreaterThan(beforeSnr + 0.5);
		expect(rms(out[0]!)).toBeLessThan(rms(noisy));
	});

	it('stronger amount suppresses more than weaker', () => {
		const clean = sine(800, 24000, 48000, 0.3);
		const noisy = add(clean, whiteNoise(24000, 0.2, 7));
		const low = applyNoiseReduction([noisy], 48000, { enabled: true, amount: 20 })[0]!;
		const high = applyNoiseReduction([noisy], 48000, { enabled: true, amount: 85 })[0]!;
		expect(rms(high)).toBeLessThan(rms(low));
	});

	it('identical preview and export pipeline: nr before pitch/eq preserves duration', async () => {
		const noisy = add(sine(440, 48000, 48000, 0.4), whiteNoise(48000, 0.15, 123));
		const processed = await processAudioChannels([noisy], {
			speed: 1.5,
			pitchShiftSemitones: 2,
			sampleRate: 48000,
			eqStages: [resolveAudioEqSettings({ highMidGainDb: 3 })],
			noiseReduction: { enabled: true, amount: 60 }
		});
		expect(processed[0]!.length).toBe(Math.floor(48000 / 1.5));
		const processed2 = await processAudioChannels([noisy.slice()], {
			speed: 1.5,
			pitchShiftSemitones: 2,
			sampleRate: 48000,
			eqStages: [resolveAudioEqSettings({ highMidGainDb: 3 })],
			noiseReduction: { enabled: true, amount: 60 }
		});
		expect(processed[0]![1000]).toBe(processed2[0]![1000]);
	});

	it('respects AbortSignal cancellation', () => {
		const noisy = whiteNoise(24000, 0.1, 5);
		const ctrl = new AbortController();
		ctrl.abort();
		expect(() =>
			applyNoiseReduction([noisy], 48000, { enabled: true, amount: 50 }, ctrl.signal)
		).toThrow();
	});
});

describe('audio noise reduction - streaming correctness and bounds', () => {
	it('one-shot, irregular tiny chunks, export windows and partial final are bit-identical within strict tolerance and exact length', () => {
		const len = 48000 * 2; // 2 sec
		const noisy = add(sine(600, len, 48000, 0.35), whiteNoise(len, 0.16, 99));
		const oneShot = applyNoiseReduction([noisy], 48000, { enabled: true, amount: 60 })[0]!;
		expect(oneShot.length).toBe(len);

		// Irregular tiny chunks: 100, 1000, 511, 2048, etc.
		const tinySizes: number[] = [];
		let remaining = len;
		let seed = 1;
		while (remaining > 0) {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			const sz = Math.min(remaining, 100 + (seed % 3000));
			tinySizes.push(sz);
			remaining -= sz;
		}
		const tiny = streamingWithChunks(noisy, tinySizes, 48000, 60);
		expect(tiny.length).toBe(len);
		expect(maxAbsDiff(oneShot, tiny)).toBeLessThan(1e-5);

		// Normal export windows: 5 sec windows (but our len is 2 sec, so one window)
		const exportWindowSizes = [48000 * 5].filter((s) => s <= len);
		const exportChunk = exportWindowSizes.length
			? streamingWithChunks(noisy, exportWindowSizes, 48000, 60)
			: oneShot;
		// For len=2sec, export window test falls back to oneShot; instead test with 10 sec
		const len2 = 48000 * 10;
		const noisy2 = add(sine(600, len2, 48000, 0.35), whiteNoise(len2, 0.16, 101));
		const oneShot2 = applyNoiseReduction([noisy2], 48000, { enabled: true, amount: 60 })[0]!;
		const exportWindows = [48000 * 5, 48000 * 5];
		const chunkedExport = streamingWithChunks(noisy2, exportWindows, 48000, 60);
		expect(chunkedExport.length).toBe(len2);
		expect(maxAbsDiff(oneShot2, chunkedExport)).toBeLessThan(1e-5);

		// Final partial chunk: 1.3 sec + 0.7 sec
		const partialSizes = [48000 * 1.3, 48000 * 0.7].map((v) => Math.floor(v));
		// Adjust to exact len
		const sum = partialSizes.reduce((a, b) => a + b, 0);
		if (sum !== len2) partialSizes[partialSizes.length - 1]! += len2 - sum;
		const partial = streamingWithChunks(noisy2, partialSizes, 48000, 60);
		expect(partial.length).toBe(len2);
		expect(maxAbsDiff(oneShot2, partial)).toBeLessThan(1e-5);
	});

	it('peak DSP memory is constant with duration and multi-minute signal processes', () => {
		const sr = 48000;
		const threeMinutes = sr * 60 * 3;
		const sig = add(sine(440, threeMinutes, sr, 0.3), whiteNoise(threeMinutes, 0.12, 7));
		const proc = new StreamingNoiseReduction(1, sr, { enabled: true, amount: 50 });
		const windowSize = 48000 * 5;
		let offset = 0;
		let totalOut = 0;
		while (offset < threeMinutes) {
			const len = Math.min(windowSize, threeMinutes - offset);
			const chunk = sig.slice(offset, offset + len);
			const isLast = offset + len >= threeMinutes;
			const out = proc.process([chunk], isLast)[0]!;
			totalOut += out.length;
			offset += len;
		}
		expect(totalOut).toBe(threeMinutes);
		// Peak temp should be bounded ~ O(FRAME) not O(duration). Allow a few MB for 5-sec windows plus overlap.
		expect(proc.getPeakTempBytes()).toBeLessThan(4 * 1024 * 1024); // 4 MB
		// Also test offline feeder for same length
		const offline = applyNoiseReduction([sig.slice(0, 48000 * 10)], sr, {
			enabled: true,
			amount: 50
		})[0]!;
		expect(offline.length).toBe(48000 * 10);
	});

	it('preserves stereo coherence: identical stereo remains identical', () => {
		const mono = add(sine(500, 24000, 48000, 0.4), whiteNoise(24000, 0.15, 13));
		const stereo = [mono.slice(), mono.slice()];
		const out = applyNoiseReduction(stereo, 48000, { enabled: true, amount: 70 });
		expect(out[0]!.length).toBe(mono.length);
		expect(out[1]!.length).toBe(mono.length);
		expect(maxAbsDiff(out[0]!, out[1]!)).toBeLessThan(1e-6);
	});

	it('preserves stereo phase/correlation', () => {
		// Left and right are same signal but right is inverted phase
		const base = sine(300, 24000, 48000, 0.4);
		const noise = whiteNoise(24000, 0.1, 21);
		const left = add(base, noise);
		const inverted = Float32Array.from(base, (v) => -v);
		const right = add(inverted, noise);
		const out = applyNoiseReduction([left, right], 48000, { enabled: true, amount: 60 });
		// After linked processing, left and right should remain anti-correlated
		// Compute correlation: sum(left*right) should be negative
		let corr = 0;
		let energy = 0;
		for (let i = 0; i < out[0]!.length; i++) {
			corr += (out[0]![i] ?? 0) * (out[1]![i] ?? 0);
			energy += (out[0]![i] ?? 0) * (out[0]![i] ?? 0);
		}
		expect(corr / (energy + 1e-12)).toBeLessThan(-0.5);
	});
});
