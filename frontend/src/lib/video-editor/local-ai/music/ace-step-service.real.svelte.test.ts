import { expect, it } from 'vitest';
import {
	ACE_STEP_STANDARD_DOWNLOAD_BYTES,
	aceStepMusicService,
	inspectMusicGenerationSupport
} from './ace-step-service';

const RUN_REAL_MODEL = import.meta.env.VITE_OPENPOST_REAL_MUSIC_TEST === '1';

it.runIf(RUN_REAL_MODEL)(
	'downloads ACE-Step and creates a real non-silent 48 kHz stereo WAV',
	async () => {
		const support = await inspectMusicGenerationSupport();
		if (!support.supported) {
			throw new Error(`The real ACE-Step test needs supported desktop Chromium: ${support.reason}`);
		}
		try {
			const stages: string[] = [];
			const result = await aceStepMusicService.generate({
				prompt:
					'Cinematic electronic instrumental, deep precise drums, warm bass, clear melodic hook, polished mix',
				durationSeconds: 10,
				audioQuality: 'standard',
				seed: 73,
				onProgress: (progress) => stages.push(progress.stage)
			});
			const bytes = new Uint8Array(await result.blob.arrayBuffer());
			expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
			expect(result.sampleRate).toBe(48_000);
			expect(result.duration).toBeCloseTo(10, 1);
			expect(bytes.byteLength).toBeGreaterThan(1_000_000);
			expect(stages).toContain('downloading');
			expect(stages).toContain('generating');

			const context = new AudioContext({ sampleRate: 48_000 });
			try {
				const decoded = await context.decodeAudioData(bytes.buffer.slice(0));
				expect(decoded.numberOfChannels).toBe(2);
				expect(decoded.sampleRate).toBe(48_000);
				const samples = decoded.getChannelData(0);
				let squareSum = 0;
				for (let index = 0; index < samples.length; index += 32) {
					const sample = samples[index];
					expect(Number.isFinite(sample)).toBe(true);
					squareSum += sample * sample;
				}
				const rms = Math.sqrt(squareSum / Math.ceil(samples.length / 32));
				expect(rms).toBeGreaterThan(0.001);
			} finally {
				await context.close();
			}

			const cache = await aceStepMusicService.inspectGenerationStorage('standard');
			expect(cache.expectedBytes).toBe(ACE_STEP_STANDARD_DOWNLOAD_BYTES);
			expect(cache.readyBytes).toBe(ACE_STEP_STANDARD_DOWNLOAD_BYTES);
			expect(cache.missingBytes).toBe(0);
		} finally {
			aceStepMusicService.unload();
		}
	},
	1_800_000
);
