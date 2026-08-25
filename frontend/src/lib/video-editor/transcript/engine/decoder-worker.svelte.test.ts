import { describe, expect, it } from 'vitest';
import DecoderWorker from './workers/decoder.worker.ts?worker';
import type { PCMChunk } from './types';
import ac3FixtureUrl from '../../media/fixtures/tone-ac3.mkv?url';

describe('transcription decoder worker', () => {
	it('streams real AC-3 audio as non-silent 16 kHz PCM', async () => {
		const response = await fetch(ac3FixtureUrl);
		expect(response.ok).toBe(true);
		const file = new File([await response.blob()], 'tone-ac3.mkv', {
			type: 'audio/x-matroska'
		});
		const worker = new DecoderWorker();
		const { port1, port2 } = new MessageChannel();
		const chunks: PCMChunk[] = [];

		try {
			worker.postMessage({ type: 'port', port: port2 }, [port2]);
			const finished = new Promise<void>((resolve, reject) => {
				worker.addEventListener('error', (event) => reject(new Error(event.message)), {
					once: true
				});
				worker.addEventListener(
					'message',
					(event: MessageEvent<{ type: string; message?: string }>) => {
						if (event.data.type === 'error') reject(new Error(event.data.message));
					}
				);
				port1.onmessage = (event: MessageEvent<PCMChunk>) => {
					chunks.push(event.data);
					port1.postMessage(0);
					if (event.data.final) resolve();
				};
			});

			worker.postMessage({ type: 'init', file, sourceStartSeconds: 0, sourceEndSeconds: 0.3 });
			await finished;

			expect(chunks.length).toBeGreaterThan(0);
			expect(chunks.at(-1)?.final).toBe(true);
			const samples = chunks.flatMap((chunk) => Array.from(chunk.samples));
			expect(samples.length).toBeGreaterThan(4_000);
			expect(samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0)).toBeGreaterThan(
				0.01
			);
		} finally {
			port1.close();
			worker.terminate();
		}
	});
});
