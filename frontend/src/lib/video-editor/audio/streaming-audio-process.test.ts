import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO_EQ_SETTINGS, StreamingAudioEq, applyAudioEqStages } from './audio-eq';
import { StreamingTimeStretch, processAudioChannels } from './process-audio';

function sine(frames: number, frequency: number, sampleRate: number): Float32Array {
	return Float32Array.from({ length: frames }, (_, frame) =>
		Math.sin((2 * Math.PI * frequency * frame) / sampleRate)
	);
}

function concatenate(parts: Float32Array[]): Float32Array {
	const output = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.length;
	}
	return output;
}

describe('streaming audio processing', () => {
	it('matches one-shot SoundTouch output while retaining state across uneven chunks', async () => {
		const sampleRate = 48_000;
		const input = sine(sampleRate * 12, 440, sampleRate);
		const tempo = 1.5;
		const pitchRatio = Math.pow(2, 3 / 12);
		const oneShot = await processAudioChannels([input, input.slice()], {
			speed: tempo,
			pitchShiftSemitones: 3,
			sampleRate
		});
		const stream = await StreamingTimeStretch.create(2, tempo, pitchRatio);
		const chunkSizes = [73_111, 131_003, 49_999, 200_003, input.length];
		const leftParts: Float32Array[] = [];
		let offset = 0;
		for (const chunkSize of chunkSizes) {
			if (offset >= input.length) break;
			const end = Math.min(input.length, offset + chunkSize);
			const output = stream.process(
				[input.subarray(offset, end), input.subarray(offset, end)],
				end === input.length
			);
			leftParts.push(output[0]!);
			offset = end;
		}
		const chunked = concatenate(leftParts);
		expect(chunked.length).toBe(oneShot[0]!.length);
		let maxDifference = 0;
		for (let frame = 0; frame < chunked.length; frame++) {
			maxDifference = Math.max(maxDifference, Math.abs(chunked[frame]! - oneShot[0]![frame]!));
		}
		expect(maxDifference).toBeLessThan(1e-6);
	});

	it('matches one-shot EQ with filter history preserved across chunks', () => {
		const sampleRate = 48_000;
		const input = sine(sampleRate * 3, 880, sampleRate);
		const stage = {
			...DEFAULT_AUDIO_EQ_SETTINGS,
			lowCutEnabled: true,
			lowCutFrequencyHz: 90,
			highMidGainDb: 4,
			highMidFrequencyHz: 2400,
			outputGainDb: -2
		};
		const oneShot = applyAudioEqStages([input], sampleRate, [stage])[0]!;
		const stream = new StreamingAudioEq(1, sampleRate, [stage]);
		const parts = [
			stream.process([input.subarray(0, 10_003)])[0]!,
			stream.process([input.subarray(10_003, 90_017)])[0]!,
			stream.process([input.subarray(90_017)])[0]!
		];
		const chunked = concatenate(parts);
		expect(chunked.length).toBe(oneShot.length);
		let maxDifference = 0;
		for (let frame = 0; frame < chunked.length; frame++) {
			maxDifference = Math.max(maxDifference, Math.abs(chunked[frame]! - oneShot[frame]!));
		}
		expect(maxDifference).toBeLessThan(1e-6);
	});
});
