/* Deterministic local noise reduction for recorded clips.
 * No cloud, no ML. Single stateful STFT pipeline shared by preview and export.
 * Preview preparation runs off the UI thread via a small worker.
 */

/* oxlint-disable anti-slop/no-magic-numbers, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unsafe-dictionary-type -- DSP constants. */

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
const BIN_COUNT = FFT_SIZE / 2 + 1;
const NOISE_PERCENTILE = 0.25;
const MIN_MAG_EPS = 1e-12;
const MAX_FRAMES = 48_000 * 60 * 30; // guard

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
	return { enabled: !!enabled, amount: clampNoiseReductionAmount(rawAmount) };
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

// ---------------------------------------------------------------------------
// Stateful bounded STFT processor. One instance is the single source of truth
// for both preview (via worker) and export. Memory is O(FRAME) plus small
// gain/noise state, not O(duration). Offline processing feeds chunks through
// this same processor.
// ---------------------------------------------------------------------------

export class StreamingNoiseReduction {
	private readonly amount: number;
	private readonly sampleRate: number;
	private readonly channelCount: number;
	private readonly floorGain: number;
	private readonly overSubtraction: number;
	private persistentFloor: number | null = null;
	private prevGain: Float64Array;
	// per-channel queues
	private inQueues: Float32Array[];
	private outQueues: Float32Array[];
	private overlap: Float32Array[];
	private totalInput = 0;
	private totalEmitted = 0;
	private maxTempBytes = 0;
	private emittedLength = 0;

	constructor(
		channelCount: number,
		sampleRate: number,
		settings: ResolvedAudioNoiseReductionSettings
	) {
		this.channelCount = Math.max(1, channelCount);
		this.sampleRate = sampleRate;
		this.amount = settings.amount;
		const normalized = settings.amount / 100;
		this.overSubtraction = 1 + normalized * 2;
		this.floorGain = 0.02 + (1 - normalized) * 0.12;
		this.prevGain = new Float64Array(BIN_COUNT);
		this.prevGain.fill(1);
		this.inQueues = Array.from({ length: this.channelCount }, () => new Float32Array(0));
		this.outQueues = Array.from({ length: this.channelCount }, () => new Float32Array(0));
		this.overlap = Array.from(
			{ length: this.channelCount },
			() => new Float32Array(FRAME_SIZE - HOP_SIZE)
		);
	}

	private trackTemp(bytes: number): void {
		if (bytes > this.maxTempBytes) this.maxTempBytes = bytes;
	}

	getPeakTempBytes(): number {
		return this.maxTempBytes;
	}

	// Append chunk to per-channel input queues
	private appendInput(channels: Float32Array[]): void {
		for (let c = 0; c < this.channelCount; c++) {
			const chunk = channels[c] ?? channels[0] ?? new Float32Array(0);
			if (chunk.length === 0) continue;
			const prev = this.inQueues[c]!;
			const next = new Float32Array(prev.length + chunk.length);
			next.set(prev, 0);
			next.set(chunk, prev.length);
			this.inQueues[c] = next;
			this.trackTemp(next.byteLength + chunk.byteLength);
		}
		this.totalInput += channels[0]?.length ?? 0;
	}

	// Process as many frames as possible using current inQueues.
	// Returns true if at least one frame was processed.
	private processFrames(signal?: AbortSignal): boolean {
		let progressed = false;
		while (this.inQueues[0]!.length >= FRAME_SIZE) {
			throwIfAborted(signal);
			// Gather frame windows for all channels
			const framesReal: Float64Array[] = [];
			const framesImag: Float64Array[] = [];
			const mags: Float64Array[] = [];
			for (let c = 0; c < this.channelCount; c++) {
				const real = new Float64Array(FFT_SIZE);
				const imag = new Float64Array(FFT_SIZE);
				const q = this.inQueues[c]!;
				for (let i = 0; i < FRAME_SIZE; i++) real[i] = (q[i] ?? 0) * (HANN[i] ?? 0);
				fftInPlace(real, imag, false);
				framesReal.push(real);
				framesImag.push(imag);
				const mag = new Float64Array(BIN_COUNT);
				for (let k = 0; k < BIN_COUNT; k++) mag[k] = Math.hypot(real[k] ?? 0, imag[k] ?? 0);
				mags.push(mag);
			}
			this.trackTemp(FRAME_SIZE * 8 * this.channelCount * 2);

			// Linked magnitude for stereo coherence: average across channels
			const linkedMag = new Float64Array(BIN_COUNT);
			for (let k = 0; k < BIN_COUNT; k++) {
				let sum = 0;
				for (let c = 0; c < this.channelCount; c++) sum += mags[c]![k] ?? 0;
				linkedMag[k] = sum / this.channelCount;
			}

			// Candidate scalar floor as low quantile across bins of linked mag
			const sorted = Float64Array.from(linkedMag).sort();
			const candidate = quantile(sorted, NOISE_PERCENTILE);
			if (this.persistentFloor === null) this.persistentFloor = candidate;
			else {
				if (candidate < this.persistentFloor) {
					this.persistentFloor = this.persistentFloor * 0.85 + candidate * 0.15;
				} else {
					this.persistentFloor = this.persistentFloor * 0.995 + candidate * 0.005;
				}
			}
			const floor = this.persistentFloor ?? candidate;
			const normalized = this.amount / 100;
			const scalarFloor = floor * (0.9 + normalized * 0.6);

			// Per-bin gain using linked mag and shared floor (with hiss bias)
			const gain = new Float64Array(BIN_COUNT);
			for (let k = 0; k < BIN_COUNT; k++) {
				const freqHz = (k * this.sampleRate) / FFT_SIZE;
				const hissBias = freqHz > 4000 ? 1.2 : freqHz < 200 ? 0.7 : 1;
				const noise = scalarFloor * hissBias;
				const mag = linkedMag[k] ?? MIN_MAG_EPS;
				let g = 1 - (this.overSubtraction * noise) / (mag + MIN_MAG_EPS);
				if (!Number.isFinite(g)) g = this.floorGain;
				g = Math.max(this.floorGain, Math.min(1, g));
				const smoothed = this.prevGain[k]! * 0.65 + g * 0.35;
				this.prevGain[k] = smoothed;
				gain[k] = smoothed;
			}

			// Apply gain to each channel's spectrum (same gain for linked coherence)
			for (let c = 0; c < this.channelCount; c++) {
				const real = framesReal[c]!;
				const imag = framesImag[c]!;
				for (let k = 0; k < BIN_COUNT; k++) {
					const g = gain[k] ?? 1;
					real[k]! *= g;
					imag[k]! *= g;
					if (k > 0 && k < BIN_COUNT - 1) {
						const mirror = FFT_SIZE - k;
						real[mirror]! *= g;
						imag[mirror]! *= g;
					}
				}
				fftInPlace(real, imag, true);
			}

			// Overlap-add with per-channel overlap buffers, emit HOP samples
			for (let c = 0; c < this.channelCount; c++) {
				const real = framesReal[c]!;
				const outQ = this.outQueues[c]!;
				const ov = this.overlap[c]!;
				// frameOut is real (time domain) length FRAME_SIZE
				// Add overlap to first HOP
				for (let i = 0; i < HOP_SIZE; i++) {
					real[i]! += ov[i] ?? 0;
				}
				// Emit first HOP as finalized
				const nextOut = new Float32Array(outQ.length + HOP_SIZE);
				nextOut.set(outQ, 0);
				for (let i = 0; i < HOP_SIZE; i++) nextOut[outQ.length + i] = real[i] ?? 0;
				this.outQueues[c] = nextOut;
				// New overlap = second half of frame
				const newOv = new Float32Array(FRAME_SIZE - HOP_SIZE);
				for (let i = 0; i < FRAME_SIZE - HOP_SIZE; i++) newOv[i] = real[HOP_SIZE + i] ?? 0;
				this.overlap[c] = newOv;
			}

			// Consume HOP input samples from each queue
			for (let c = 0; c < this.channelCount; c++) {
				const q = this.inQueues[c]!;
				this.inQueues[c] = q.slice(HOP_SIZE);
			}
			progressed = true;
		}
		return progressed;
	}

	process(channels: Float32Array[], isLast = false, signal?: AbortSignal): Float32Array[] {
		if (channels.length === 0) return [];
		throwIfAborted(signal);
		const inputLen = channels[0]?.length ?? 0;
		if (inputLen === 0 && !isLast) return channels.map(() => new Float32Array(0));

		if (inputLen > 0) this.appendInput(channels);
		this.processFrames(signal);

		if (isLast) {
			// Flush remaining: pad with zeros until all input emitted
			// We need to emit exactly totalInput samples. Currently emitted is sum of outQueues lengths.
			// We have overlap tail of 512 samples not yet emitted, and possibly partial input < FRAME_SIZE
			// Pad inQueues with zeros to make final frames.
			while (this.emittedLength + this.outQueues[0]!.length < this.totalInput) {
				throwIfAborted(signal);
				// Pad each inQueue with zeros up to FRAME_SIZE if needed
				for (let c = 0; c < this.channelCount; c++) {
					const q = this.inQueues[c]!;
					if (q.length < FRAME_SIZE) {
						const padded = new Float32Array(FRAME_SIZE);
						padded.set(q, 0);
						this.inQueues[c] = padded;
					}
				}
				// Process one more frame (will consume HOP)
				const did = this.processFrames(signal);
				if (!did) break;
				// If still not enough emitted, continue
				if (this.outQueues[0]!.length >= this.totalInput - this.emittedLength) break;
			}
			// If still short due to very short input, pad outQueues with zeros
			for (let c = 0; c < this.channelCount; c++) {
				const out = this.outQueues[c]!;
				const needed = this.totalInput - this.emittedLength;
				if (out.length < needed) {
					const padded = new Float32Array(needed);
					padded.set(out, 0);
					this.outQueues[c] = padded;
				}
			}
		}

		// Drain outQueues up to inputLen (or all if isLast)
		const want = isLast
			? this.totalInput - this.emittedLength
			: Math.min(inputLen, this.outQueues[0]!.length);
		const result: Float32Array[] = [];
		for (let c = 0; c < this.channelCount; c++) {
			const out = this.outQueues[c]!;
			const take = Math.min(want, out.length);
			const chunk = out.slice(0, take);
			this.outQueues[c] = out.slice(take);
			result.push(Float32Array.from(chunk, (v) => Math.max(-1, Math.min(1, v))));
		}
		this.emittedLength += want;
		return result;
	}

	// Convenience for exact-length retrieval
	flush(signal?: AbortSignal): Float32Array[] {
		return this.process([], true, signal);
	}
}

// Offline is thin feeder into same processor
export function applyNoiseReduction(
	channels: Float32Array[],
	sampleRate: number,
	settings: ResolvedAudioNoiseReductionSettings,
	signal?: AbortSignal
): Float32Array[] {
	if (!isNoiseReductionActive(settings)) return channels.map((c) => c.slice());
	if (sampleRate <= 0 || channels.length === 0 || (channels[0]?.length ?? 0) === 0)
		return channels.map((c) => c.slice());
	const total = channels[0]!.length;
	if (total > MAX_FRAMES) throw new Error('Noise reduction input too long');
	const proc = new StreamingNoiseReduction(channels.length, sampleRate, settings);
	// Feed in bounded windows to prove chunk independence; single call also works
	const chunkSize = 24000; // ~0.5 sec windows for offline feeder
	const outChannels: Float32Array[][] = [];
	let offset = 0;
	while (offset < total) {
		throwIfAborted(signal);
		const len = Math.min(chunkSize, total - offset);
		const chunk = channels.map((ch) => ch.slice(offset, offset + len));
		const isLast = offset + len >= total;
		const out = proc.process(chunk, isLast, signal);
		if (out[0]?.length) outChannels.push(out);
		offset += len;
	}
	// Concatenate
	const result: Float32Array[] = Array.from(
		{ length: channels.length },
		() => new Float32Array(total)
	);
	for (let c = 0; c < channels.length; c++) {
		let pos = 0;
		for (const part of outChannels) {
			const p = part[c]!;
			result[c]!.set(p, pos);
			pos += p.length;
		}
		// Trim/pad to exact total (should already be exact)
		if (pos !== total) {
			const trimmed = result[c]!.slice(0, pos);
			const padded = new Float32Array(total);
			padded.set(trimmed, 0);
			result[c] = padded;
		}
	}
	return result;
}
