import { expect, it } from 'vitest';
import { supertonicTtsService } from './supertonic-service';

const RUN_REAL_MODEL = import.meta.env.VITE_OPENPOST_REAL_LOCAL_AI_TEST === '1';

it.runIf(RUN_REAL_MODEL)(
	'loads Supertonic and generates a real multilingual local voice WAV',
	async () => {
		const stages: string[] = [];
		try {
			const result = await supertonicTtsService.generateSpeechFile({
				text: 'OpenPost creates this voice locally.',
				voice: 'M3',
				language: 'en',
				speed: 1,
				onProgress: (progress) => stages.push(progress.stage)
			});
			const bytes = new Uint8Array(await result.blob.arrayBuffer());

			expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
			expect(result.duration).toBeGreaterThan(0.5);
			expect(result.sampleRate).toBeGreaterThan(0);
			expect(stages).toContain('preparing');
			expect(stages).toContain('generating');
			expect(stages.at(-1)).toBe('finalizing');
		} finally {
			await supertonicTtsService.unload();
		}
	},
	900_000
);
