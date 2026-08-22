import { describe, expect, it } from 'vitest';
import { loadWaveform, saveWaveform, type WaveformPersistenceStore } from './waveform-persistence';

const files = new Map<string, Blob>();
const memoryStore: WaveformPersistenceStore = {
	write: async (_kind, key, name, blob) => {
		files.set(`${key}/${name}`, blob);
	},
	read: async (_kind, key, name) => files.get(`${key}/${name}`) ?? null
};

describe('waveform persistence', () => {
	it('round-trips peaks without JSON expansion', async () => {
		await saveWaveform(
			'm',
			{
				peaks: new Float32Array([0.1, -0.5, 1]),
				durationSeconds: 2.5,
				samplesPerSecond: 50
			},
			memoryStore
		);
		const restored = await loadWaveform('m', memoryStore);
		expect(restored?.durationSeconds).toBe(2.5);
		expect(restored?.samplesPerSecond).toBe(50);
		expect([...restored!.peaks]).toEqual([expect.closeTo(0.1), -0.5, 1]);
	});
});
