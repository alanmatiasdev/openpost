import { describe, expect, it } from 'vitest';
import {
	applyNoiseReduction,
	clampNoiseReductionAmount,
	StreamingNoiseReduction,
	isNoiseReductionActive,
	resolveNoiseReductionSettings
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
		// bypass should be bit-equal copy
		for (let i = 0; i < ch.length; i++) expect(out[0]![i]).toBe(ch[i]);
	});

	it('reduces hiss and improves SNR vs clean truth', () => {
		const clean = sine(1000, 48000, 48000, 0.4);
		const noise = whiteNoise(48000, 0.18, 42);
		const noisy = add(clean, noise);
		const beforeSnr = snr(clean, noisy);
		const out = applyNoiseReduction([noisy], 48000, { enabled: true, amount: 75 });
		const afterSnr = snr(clean, out[0]!);
		// Must measurably improve SNR and lower RMS error
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

	it('streaming parity: chunked equals whole', () => {
		const noisy = add(sine(600, 48000, 48000, 0.35), whiteNoise(48000, 0.16, 99));
		const whole = applyNoiseReduction([noisy], 48000, { enabled: true, amount: 60 })[0]!;
		const streamer = new StreamingNoiseReduction(1, 48000, { enabled: true, amount: 60 });
		const a = noisy.slice(0, 24000);
		const b = noisy.slice(24000);
		const outA = streamer.process([a])[0]!;
		const outB = streamer.process([b])[0]!;
		const chunked = new Float32Array(48000);
		chunked.set(outA, 0);
		chunked.set(outB, 24000);
		// Parity within small tolerance due to tail handling; whole vs chunked should be close
		let diffRms = 0;
		for (let i = 512; i < 48000 - 512; i++) {
			const d = (whole[i] ?? 0) - (chunked[i] ?? 0);
			diffRms += d * d;
		}
		diffRms = Math.sqrt(diffRms / (48000 - 1024));
		expect(diffRms).toBeLessThan(0.02);
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
		// time-stretch 1.5 should shorten
		expect(processed[0]!.length).toBe(Math.floor(48000 / 1.5));
		// second call with same inputs must give identical output (determinism)
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
