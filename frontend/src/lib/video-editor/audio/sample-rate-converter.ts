/**
 * Absolute-phase sample-rate conversion and channel mapping.
 *
 * Mirrors FreeCut canvas-audio.ts's OfflineAudioContext resampling and ITU
 * downmix but exposes a plain-F32 path so chunked, long-duration work can
 * keep the same sample count as a single uninterrupted conversion. No
 * per-chunk rounding leaks into the total length.
 */

const SQRT_HALF = Math.SQRT1_2;

export function expectedOutputFrames(
	inputFrames: number,
	sourceRate: number,
	targetRate: number
): number {
	if (sourceRate === targetRate) return inputFrames;
	if (inputFrames === 0) return 0;
	return Math.round((inputFrames * targetRate) / sourceRate);
}

export function resampleChannelLinear(
	channel: Float32Array,
	sourceRate: number,
	targetRate: number
): Float32Array {
	if (sourceRate === targetRate) return channel.slice();
	const outputFrames = expectedOutputFrames(channel.length, sourceRate, targetRate);
	const output = new Float32Array(outputFrames);
	const ratio = sourceRate / targetRate;
	for (let out = 0; out < outputFrames; out++) {
		const pos = out * ratio;
		const left = Math.floor(pos);
		const frac = pos - left;
		const leftSample = channel[left] ?? 0;
		const rightSample = channel[left + 1] ?? 0;
		output[out] = leftSample * (1 - frac) + rightSample * frac;
	}
	return output;
}

export function resampleAudioChannels(
	channels: Float32Array[],
	sourceRate: number,
	targetRate: number
): Float32Array[] {
	if (sourceRate === targetRate) return channels.map((c) => c.slice());
	return channels.map((channel) => resampleChannelLinear(channel, sourceRate, targetRate));
}

export class AbsolutePhaseResampler {
	private totalInput = 0;
	private totalOutput = 0;
	private buffered = new Float32Array(0);

	constructor(
		private readonly sourceRate: number,
		private readonly targetRate: number
	) {}

	processChunk(chunk: Float32Array, isLast: boolean): Float32Array {
		const combined = new Float32Array(this.buffered.length + chunk.length);
		combined.set(this.buffered, 0);
		combined.set(chunk, this.buffered.length);
		const nextTotalInput = this.totalInput + chunk.length;
		const nextTotalOutput = expectedOutputFrames(nextTotalInput, this.sourceRate, this.targetRate);
		const chunkOutputFrames = nextTotalOutput - this.totalOutput;
		const output = new Float32Array(chunkOutputFrames);
		for (let i = 0; i < chunkOutputFrames; i++) {
			const globalOut = this.totalOutput + i;
			const srcPos = (globalOut * this.sourceRate) / this.targetRate;
			const localPos = srcPos - (this.totalInput - this.buffered.length);
			const left = Math.floor(localPos);
			const frac = localPos - left;
			const leftSample = combined[left] ?? 0;
			const rightSample = combined[left + 1] ?? 0;
			output[i] = leftSample * (1 - frac) + rightSample * frac;
		}
		this.totalInput = nextTotalInput;
		this.totalOutput = nextTotalOutput;
		if (chunk.length > 0) this.buffered = new Float32Array([chunk[chunk.length - 1]!]);
		else this.buffered = new Float32Array(0);
		if (isLast) this.buffered = new Float32Array(0);
		return output;
	}

	flush(): Float32Array {
		return new Float32Array(0);
	}

	reset(): void {
		this.totalInput = 0;
		this.totalOutput = 0;
		this.buffered = new Float32Array(0);
	}
}

/** ITU-R BS.775 Lo/Ro downmix: L,R,C,Ls,Rs,Lr,Rr -> stereo. LFE dropped. */
export function downmixToStereo(source: readonly Float32Array[]): Float32Array[] {
	const [L, R, C, _LFE, Ls, Rs, Lr, Rr] = source;
	const length = L?.length ?? R?.length ?? C?.length ?? Ls?.length ?? Rs?.length ?? 0;
	if (length === 0) return [new Float32Array(0), new Float32Array(0)];
	const left = new Float32Array(length);
	const right = new Float32Array(length);
	for (let i = 0; i < length; i++) {
		let lo = L?.[i] ?? 0;
		let ro = R?.[i] ?? 0;
		const c = C?.[i];
		if (c !== undefined) {
			lo += SQRT_HALF * c;
			ro += SQRT_HALF * c;
		}
		const ls = Ls?.[i];
		if (ls !== undefined) lo += SQRT_HALF * ls;
		const rs = Rs?.[i];
		if (rs !== undefined) ro += SQRT_HALF * rs;
		const lr = Lr?.[i];
		if (lr !== undefined) lo += SQRT_HALF * lr;
		const rr = Rr?.[i];
		if (rr !== undefined) ro += SQRT_HALF * rr;
		left[i] = lo;
		right[i] = ro;
	}
	return [left, right];
}

export function downmixToOutputChannels(
	source: readonly Float32Array[],
	outputChannels: number
): Float32Array[] {
	if (source.length === 0) return [];
	if (outputChannels <= 0) return [];
	if (source.length === outputChannels) return source.map((c) => c.slice());
	if (source.length === 1) {
		const mono = source[0]!;
		return Array.from({ length: outputChannels }, () => mono.slice());
	}
	if (outputChannels === 2) return downmixToStereo(source);
	if (outputChannels === 1) {
		const stereo = downmixToStereo(source);
		const left = stereo[0]!;
		const right = stereo[1]!;
		const mono = new Float32Array(left.length);
		for (let i = 0; i < mono.length; i++) mono[i] = (left[i]! + right[i]!) * 0.5;
		return [mono];
	}
	const out: Float32Array[] = [];
	for (let c = 0; c < outputChannels; c++)
		out.push(source[c]?.slice() ?? new Float32Array(source[0]!.length));
	return out;
}

export function ensureStereo(channels: Float32Array[]): Float32Array[] {
	return downmixToOutputChannels(channels, 2);
}
