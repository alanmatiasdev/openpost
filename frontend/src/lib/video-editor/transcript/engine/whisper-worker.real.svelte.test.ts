import { expect, it } from 'vitest';
import WhisperWorker from './workers/whisper.worker.ts?worker';
import type { MainThreadMessage, PCMChunk } from './types';

const RUN_REAL_MODEL = import.meta.env.VITE_OPENPOST_REAL_LOCAL_AI_TEST === '1';

it.runIf(RUN_REAL_MODEL)(
	'loads Whisper Tiny and completes a real local inference job',
	async () => {
		const worker = new WhisperWorker();
		const messages: MainThreadMessage[] = [];
		const { port1, port2 } = new MessageChannel();
		try {
			worker.postMessage({ type: 'port', port: port2 }, [port2]);
			const finished = new Promise<void>((resolve, reject) => {
				worker.addEventListener('error', (event) => reject(new Error(event.message)), {
					once: true
				});
				worker.addEventListener('message', (event: MessageEvent<MainThreadMessage>) => {
					messages.push(event.data);
					if (event.data.type === 'ready') {
						const samples = new Float32Array(16_000);
						const chunk: PCMChunk = {
							samples,
							timestamp: 0,
							final: true,
							totalDuration: 1
						};
						port1.postMessage(chunk, [samples.buffer]);
					} else if (event.data.type === 'error') {
						reject(new Error(event.data.message));
					} else if (event.data.type === 'done') {
						resolve();
					}
				});
			});

			worker.postMessage({
				type: 'init',
				modelId: 'onnx-community/whisper-tiny_timestamped',
				language: 'en',
				quantization: 'hybrid'
			});
			await finished;

			expect(messages.some((message) => message.type === 'ready')).toBe(true);
			expect(
				messages.some(
					(message) => message.type === 'progress' && message.event.stage === 'preparing'
				)
			).toBe(true);
			expect(
				messages.some(
					(message) =>
						message.type === 'progress' &&
						message.event.stage === 'transcribing' &&
						message.event.progress === 1
				)
			).toBe(true);
		} finally {
			port1.close();
			worker.terminate();
		}
	},
	240_000
);
