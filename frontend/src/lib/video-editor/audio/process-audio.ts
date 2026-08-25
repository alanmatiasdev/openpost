import { applyAudioEqStages } from './audio-eq';
import { getAudioPitchRatioFromSemitones, isAudioPitchShiftActive } from './audio-pitch';
import type { ResolvedAudioEqSettings } from './types';

export interface AudioProcessOptions {
	speed: number;
	pitchShiftSemitones: number;
	sampleRate: number;
	eqStages?: ReadonlyArray<ResolvedAudioEqSettings>;
}

/**
 * Apply clip tempo, independent pitch, then EQ to all channels as one stereo
 * SoundTouch stream. Sharing the overlap search keeps left and right in phase.
 */
export async function processAudioChannels(
	channels: Float32Array[],
	options: AudioProcessOptions
): Promise<Float32Array[]> {
	const speed = Number.isFinite(options.speed) && options.speed > 0 ? options.speed : 1;
	let processed = channels;
	if (
		channels.length > 0 &&
		(channels[0]?.length ?? 0) > 0 &&
		(Math.abs(speed - 1) > 0.0001 || isAudioPitchShiftActive(options.pitchShiftSemitones))
	) {
		processed = await timeStretchChannels(
			channels,
			speed,
			getAudioPitchRatioFromSemitones(options.pitchShiftSemitones)
		);
	}
	return applyAudioEqStages(processed, options.sampleRate, options.eqStages);
}

async function timeStretchChannels(
	channels: Float32Array[],
	tempo: number,
	pitchRatio: number
): Promise<Float32Array[]> {
	const { TimeStretchFilter, TimeStretchProcessor } = await import('./time-stretch');
	const channelCount = channels.length;
	const inputFrames = channels[0]?.length ?? 0;
	const left = channels[0]!;
	const right = channels[1] ?? left;

	const processor = new TimeStretchProcessor();
	processor.tempo = tempo;
	processor.pitch = pitchRatio;
	processor.rate = 1;
	let inputOffsetFrames = 0;
	const source = {
		extract(target: Float32Array, requestedFrames: number): number {
			const availableFrames = inputFrames - inputOffsetFrames;
			const frames = Math.min(requestedFrames, availableFrames);
			for (let frame = 0; frame < frames; frame++) {
				const sourceFrame = inputOffsetFrames + frame;
				target[frame * 2] = left[sourceFrame] ?? 0;
				target[frame * 2 + 1] = right[sourceFrame] ?? 0;
			}
			inputOffsetFrames += frames;
			// SoundTouch consumes fixed 16,384-frame input windows. A silent tail
			// flushes its overlap buffers instead of dropping the final window.
			return requestedFrames;
		}
	};
	const filter = new TimeStretchFilter(source, processor);
	const expectedFrames = Math.max(1, Math.floor(inputFrames / tempo));
	const outputs = Array.from({ length: channelCount }, () => new Float32Array(expectedFrames));
	const chunkFrames = 4096;
	const chunk = new Float32Array(chunkFrames * 2);
	let outputFrames = 0;
	while (outputFrames < expectedFrames) {
		const frames = filter.extract(chunk, Math.min(chunkFrames, expectedFrames - outputFrames));
		if (frames <= 0) break;
		for (let frame = 0; frame < frames; frame++) {
			const outputFrame = outputFrames + frame;
			outputs[0]![outputFrame] = chunk[frame * 2] ?? 0;
			if (channelCount > 1) outputs[1]![outputFrame] = chunk[frame * 2 + 1] ?? 0;
			for (let channel = 2; channel < channelCount; channel++) {
				outputs[channel]![outputFrame] = chunk[frame * 2] ?? 0;
			}
		}
		outputFrames += frames;
	}
	return outputFrames === expectedFrames
		? outputs
		: outputs.map((channel) => channel.slice(0, outputFrames));
}
