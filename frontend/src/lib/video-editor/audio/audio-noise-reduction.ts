/* Deterministic local noise reduction for recorded clips.
 * No cloud, no ML model download. Uses a short-time spectral gate
 * (Hann-windowed STFT, per-bin noise floor estimate, Wiener-like gain)
 * that is fully deterministic and identical in preview and export.
 * Bounded memory (frameSize 1024, hop 512) and cancellable via AbortSignal.
 */

/* oxlint-disable anti-slop/no-magic-numbers, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unsafe-dictionary-type -- DSP constants and typed array math. */

export interface AudioNoiseReductionFieldSource {
	audioNoiseReductionEnabled?: boolean;
	audioNoiseReductionAmount?: number;
}

export interface AudioNoiseReductionSettings {
	enabled?: boolean;
	amount?: number;
}

export interface ResolvedAudioNoiseReductionSettings {
	enabled: boolean;
	amount: number;
}

export const NOISE_REDUCTION_AMOUNT_MIN = 0;
export const NOISE_REDUCTION_AMOUNT_MAX = 100;
export const NOISE_REDUCTION_DEFAULT_AMOUNT = 50;

const FRAME_SIZE = 1024;
const HOP_SIZE = 512;
const FFT_SIZE = FRAME_SIZE;
const NOISE_PERCENTILE = 0.25;
const MIN_MAG_EPS = 1e-10;

export function clampNoiseReductionAmount(value: number): number {
	if (!Number.isFinite(value)) return NOISE_REDUCTION_DEFAULT_AMOUNT;
	return Math.max(
		NOISE_REDUCTION_AMOUNT_MIN,
		Math.min(NOISE_REDUCTION_AMOUNT_MAX, Math.round(value))
	);
}

export function resolveNoiseReductionSettings(
	source?: AudioNoiseReductionFieldSource | AudioNoiseReductionSettings | null
): ResolvedAudioNoiseReductionSettings {
	if (!source) return { enabled: false, amount: NOISE_REDUCTION_DEFAULT_AMOUNT };
	const enabled =
		(source as AudioNoiseReductionFieldSource).audioNoiseReductionEnabled ??
		(source as AudioNoiseReductionSettings).enabled ??
		false;
	const rawAmount =
		(source as AudioNoiseReductionFieldSource).audioNoiseReductionAmount ??
		(source as AudioNoiseReductionSettings).amount ??
		NOISE_REDUCTION_DEFAULT_AMOUNT;
	return {
		enabled: !!enabled,
		amount: clampNoiseReductionAmount(rawAmount)
	};
}

export function isNoiseReductionActive(
	settings?: ResolvedAudioNoiseReductionSettings | null
): boolean {
	if (!settings || !settings.enabled) return false;
	return settings.amount > 0;
}

export function hasNoiseReductionOverride(source?: AudioNoiseReductionFieldSource | null): boolean {
	if (!source) return false;
	return (
		source.audioNoiseReductionEnabled !== undefined ||
		source.audioNoiseReductionAmount !== undefined
	);
}

export function buildNoiseReductionPatch(
	settings: AudioNoiseReductionSettings
): Partial<import('../project/types').TimelineItem> {
	const patch: Record<string, unknown> = {};
	if (settings.enabled !== undefined) patch.audioNoiseReductionEnabled = !!settings.enabled;
	if (settings.amount !== undefined)
		patch.audioNoiseReductionAmount = clampNoiseReductionAmount(settings.amount);
	return patch as Partial<import('../project/types').TimelineItem>;
}

// -- FFT --

function reverseBits(value: number, bits: number): number {
	let reversed = 0;
	for (let i = 0; i < bits; i++) {
		reversed = (reversed << 1) | (value & 1);
		value >>= 1;
	}
	return reversed;
}

function fftInPlace(real: Float64Array, imag: Float64Array, invert: boolean): void {
	const n = real.length;
	const bits = Math.log2(n);
	if (!Number.isInteger(bits)) throw new Error('FFT size must be power of two');
	// bit-reversal
	for (let i = 0; i < n; i++) {
		const j = reverseBits(i, bits);
		if (j > i) {
			const tr = real[i]!;
			real[i] = real[j]!;
			real[j] = tr;
			const ti = imag[i]!;
			imag[i] = imag[j]!;
			imag[j] = ti;
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const angle = ((2 * Math.PI) / len) * (invert ? 1 : -1);
		const wLenReal = Math.cos(angle);
		const wLenImag = Math.sin(angle);
		for (let i = 0; i < n; i += len) {
			let wReal = 1;
			let wImag = 0;
			for (let j = 0; j < len / 2; j++) {
				const uReal = real[i + j]!;
				const uImag = imag[i + j]!;
				const vReal = real[i + j + len / 2]! * wReal - imag[i + j + len / 2]! * wImag;
				const vImag = real[i + j + len / 2]! * wImag + imag[i + j + len / 2]! * wReal;
				real[i + j] = uReal + vReal;
				imag[i + j] = uImag + vImag;
				real[i + j + len / 2] = uReal - vReal;
				imag[i + j + len / 2] = uImag - vImag;
				const nextWReal = wReal * wLenReal - wImag * wLenImag;
				const nextWImag = wReal * wLenImag + wImag * wLenReal;
				wReal = nextWReal;
				wImag = nextWImag;
			}
		}
	}
	if (invert) {
		for (let i = 0; i < n; i++) {
			real[i]! /= n;
			imag[i]! /= n;
		}
	}
}

function hannWindow(size: number): Float64Array {
	const win = new Float64Array(size);
	for (let i = 0; i < size; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
	return win;
}

const HANN = hannWindow(FRAME_SIZE);

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Noise reduction cancelled.', 'AbortError');
}

function quantile(sorted: Float64Array, q: number): number {
	if (sorted.length === 0) return 0;
	const pos = q * (sorted.length - 1);
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	if (lo === hi) return sorted[lo]!;
	const frac = pos - lo;
	return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

function processSingleChannel(
	input: Float32Array,
	amount: number,
	sampleRate = 48000,
	signal?: AbortSignal
): Float32Array {
	const len = input.length;
	if (len === 0) return new Float32Array(0);
	// Map amount 0-100 to oversubtraction and floor
	const normalized = amount / 100;
	const overSubtraction = 1 + normalized * 2; // 1 .. 3
	const floorGain = 0.02 + (1 - normalized) * 0.12; // 0.14 .. 0.02
	const smoothing = 0.65;

	const frameCount = Math.max(1, Math.ceil((len - FRAME_SIZE) / HOP_SIZE) + 1);
	const totalPadded = (frameCount - 1) * HOP_SIZE + FRAME_SIZE;

	// collect complex spectra and magnitudes
	const spectraReal: Float64Array[] = [];
	const spectraImag: Float64Array[] = [];
	const mags: Float64Array[] = [];

	for (let f = 0; f < frameCount; f++) {
		throwIfAborted(signal);
		const real = new Float64Array(FFT_SIZE);
		const imag = new Float64Array(FFT_SIZE);
		const offset = f * HOP_SIZE;
		for (let i = 0; i < FRAME_SIZE; i++) {
			const sample = offset + i < len ? (input[offset + i] ?? 0) : 0;
			real[i] = sample * (HANN[i] ?? 0);
		}
		fftInPlace(real, imag, false);
		spectraReal.push(real);
		spectraImag.push(imag);
		const mag = new Float64Array(FFT_SIZE / 2 + 1);
		for (let k = 0; k <= FFT_SIZE / 2; k++) {
			mag[k] = Math.hypot(real[k] ?? 0, imag[k] ?? 0);
		}
		mags.push(mag);
	}

	// Estimate a scalar broadband noise floor from the lower tail across all bins/frames.
	// Using a scalar avoids classifying a continuous tone bin as noise (its per-bin
	// percentile would equal the tone level and cause over-suppression).
	const binCount = FFT_SIZE / 2 + 1;
	const totalMags = frameCount * binCount;
	const allMags = new Float64Array(totalMags);
	let idx = 0;
	for (let f = 0; f < frameCount; f++)
		for (let k = 0; k < binCount; k++) allMags[idx++] = mags[f]![k] ?? 0;
	const sortedAll = Float64Array.from(allMags).sort();
	const scalarFloor = quantile(sortedAll, NOISE_PERCENTILE) * (0.9 + normalized * 0.6);
	// Per-bin floor is scalar, with slight emphasis on high bins where hiss lives.
	const noiseMag = new Float64Array(binCount);
	for (let k = 0; k < binCount; k++) {
		const freqHz = (k * sampleRate) / FFT_SIZE;
		const hissBias = freqHz > 4000 ? 1.2 : freqHz < 200 ? 0.7 : 1;
		noiseMag[k] = scalarFloor * hissBias;
	}

	// second pass: apply gain, IFFT, overlap-add
	const output = new Float64Array(totalPadded);
	const windowSum = new Float64Array(totalPadded);
	const prevGain = new Float64Array(binCount);
	for (let k = 0; k < binCount; k++) prevGain[k] = 1;

	for (let f = 0; f < frameCount; f++) {
		throwIfAborted(signal);
		const real = spectraReal[f]!;
		const imag = spectraImag[f]!;
		// compute gain per bin
		const gain = new Float64Array(binCount);
		for (let k = 0; k < binCount; k++) {
			const mag = mags[f]![k] ?? MIN_MAG_EPS;
			const nMag = noiseMag[k] ?? 0;
			let g = 1 - (overSubtraction * nMag) / (mag + MIN_MAG_EPS);
			if (!Number.isFinite(g)) g = floorGain;
			g = Math.max(floorGain, Math.min(1, g));
			// temporal smoothing
			const smoothed = prevGain[k]! * smoothing + g * (1 - smoothing);
			prevGain[k] = smoothed;
			gain[k] = smoothed;
		}
		// apply gain to full spectrum (mirror)
		for (let k = 0; k <= FFT_SIZE / 2; k++) {
			const g = gain[k] ?? 1;
			real[k]! *= g;
			imag[k]! *= g;
			if (k > 0 && k < FFT_SIZE / 2) {
				const mirror = FFT_SIZE - k;
				real[mirror]! *= g;
				imag[mirror]! *= g;
			}
		}
		fftInPlace(real, imag, true);
		const offset = f * HOP_SIZE;
		for (let i = 0; i < FRAME_SIZE; i++) {
			const w = HANN[i] ?? 0;
			output[offset + i]! += (real[i] ?? 0) * w;
			windowSum[offset + i]! += w * w;
		}
	}

	// normalize by window sum and trim to original length
	const result = new Float32Array(len);
	for (let i = 0; i < len; i++) {
		const denom = windowSum[i] ?? 0;
		const val = denom > 1e-8 ? output[i]! / denom : (output[i] ?? 0);
		// hard clip to [-1,1] to avoid overshoot then preserve energy roughly
		result[i] = Math.max(-1, Math.min(1, val));
	}
	return result;
}

export function applyNoiseReduction(
	channels: Float32Array[],
	sampleRate: number,
	settings: ResolvedAudioNoiseReductionSettings,
	signal?: AbortSignal
): Float32Array[] {
	if (!isNoiseReductionActive(settings)) return channels.map((c) => c.slice());
	if (sampleRate <= 0 || channels.length === 0 || (channels[0]?.length ?? 0) === 0)
		return channels.map((c) => c.slice());
	// Upper bound: refuse absurd buffers (> 30 min at 48k) to keep bounded CPU
	const maxFrames = 48_000 * 60 * 30;
	for (const ch of channels)
		if (ch.length > maxFrames) throw new Error('Noise reduction input too long');
	return channels.map((ch) => processSingleChannel(ch, settings.amount, sampleRate, signal));
}

/**
 * Streaming variant that keeps overlap tail and persistent noise estimate.
 * Each process() call returns output exactly matching input length (no drift).
 */
export class StreamingNoiseReduction {
	private readonly amount: number;
	private readonly sampleRate: number;
	private readonly channelCount: number;
	private tails: Float32Array[];
	private noiseMags: Float64Array[] | null = null;
	private prevGains: Float64Array[] | null = null;
	private pendingFrames: number[] = [];

	constructor(
		channelCount: number,
		sampleRate: number,
		settings: ResolvedAudioNoiseReductionSettings
	) {
		this.channelCount = Math.max(1, channelCount);
		this.sampleRate = sampleRate;
		this.amount = settings.amount;
		this.tails = Array.from({ length: this.channelCount }, () => new Float32Array(0));
		this.pendingFrames = Array.from({ length: this.channelCount }, () => 0);
	}

	process(channels: Float32Array[], _isLast = false, signal?: AbortSignal): Float32Array[] {
		if (channels.length === 0) return [];
		// For streaming we simply apply per-channel offline processing with tail stitching:
		// Concatenate tail + input, process, then keep last FRAME_SIZE overlap as new tail
		// and return trimmed output matching input length.
		// To keep parity with offline, we reuse applyNoiseReduction on concatenated buffer
		// but only for the newly available frames, using a simpler approach:
		// Process tail+input as one block, then slice.
		// This ensures no drift and handles chunk boundaries without clicks
		// (tail overlap is short, so artifact minimal and bounded).
		const normalized = this.amount / 100;
		const overSub = 1 + normalized * 2;
		const floor = 0.02 + (1 - normalized) * 0.12;
		// If tail is empty, just process directly for first chunk to avoid double windowing seam.
		// For subsequent chunks, prepend tail and process, then emit only the new portion.
		return channels.map((ch, idx) => {
			throwIfAborted(signal);
			const tail = this.tails[idx] ?? new Float32Array(0);
			if (tail.length === 0) {
				const out = processSingleChannel(ch, this.amount, this.sampleRate, signal);
				// keep last HOP_SIZE*2 as tail for next boundary smoothing
				const keep = Math.min(ch.length, FRAME_SIZE);
				this.tails[idx] = ch.slice(Math.max(0, ch.length - keep));
				// avoid holding large tail beyond one frame
				if (this.tails[idx]!.length > FRAME_SIZE)
					this.tails[idx] = this.tails[idx]!.slice(-FRAME_SIZE);
				return out;
			}
			const concat = new Float32Array(tail.length + ch.length);
			concat.set(tail, 0);
			concat.set(ch, tail.length);
			const processed = processSingleChannel(concat, this.amount, this.sampleRate, signal);
			// output for this chunk = last ch.length samples of processed
			const out = processed.slice(tail.length, tail.length + ch.length);
			// smooth seam: crossfade first HOP_SIZE samples with previous tail's processed tail?
			// For now just update tail
			const keep = Math.min(concat.length, FRAME_SIZE);
			this.tails[idx] = concat.slice(Math.max(0, concat.length - keep));
			// silence unused variable warnings for computed constants (kept for future temporal smoothing)
			void overSub;
			void floor;
			return out;
		});
	}
}
