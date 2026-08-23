import { expect, it } from 'vitest';
import { kokoroTtsService } from './kokoro-service';

const RUN_REAL_MODEL = import.meta.env.VITE_OPENPOST_REAL_LOCAL_AI_TEST === '1';

it.runIf(RUN_REAL_MODEL)(
	'loads Kokoro and generates a real local voice WAV',
	async () => {
		if (!kokoroTtsService.isSupported()) {
			throw new Error('The real Kokoro test needs a Chromium WebGPU runtime.');
		}
		try {
			const stages: string[] = [];
			const result = await kokoroTtsService.generateSpeechFile({
				text: 'OpenPost keeps your voiceover work on this device.',
				voice: 'af_heart',
				speed: 1,
				onProgress: (progress) => stages.push(progress.stage)
			});
			const bytes = new Uint8Array(await result.blob.arrayBuffer());

			expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
			expect(result.duration).toBeGreaterThan(0.5);
			expect(result.sampleRate).toBeGreaterThan(0);
			expect(stages).toContain('downloading');
			expect(stages).toContain('generating');
			expect(stages.at(-1)).toBe('finalizing');
		} finally {
			await kokoroTtsService.unload();
		}
	},
	600_000
);
