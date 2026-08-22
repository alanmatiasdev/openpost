import { describe, expect, it, vi } from 'vitest';
import { loadWaveform, saveWaveform } from './waveform-persistence';

const files = new Map<string, Blob>();
vi.mock('./opfs-cache', () => ({
	writeOpfsBlob: async (_kind: string, key: string, name: string, blob: Blob) => {
		files.set(`${key}/${name}`, blob);
	},
	readOpfsBlob: async (_kind: string, key: string, name: string) =>
		files.get(`${key}/${name}`) ?? null
}));

describe('waveform persistence', () => {
	it('round-trips peaks without JSON expansion', async () => {
		await saveWaveform('m', {
			peaks: new Float32Array([0.1, -0.5, 1]),
			durationSeconds: 2.5,
			samplesPerSecond: 50
		});
		const restored = await loadWaveform('m');
		expect(restored?.durationSeconds).toBe(2.5);
		expect(restored?.samplesPerSecond).toBe(50);
		expect([...restored!.peaks]).toEqual([expect.closeTo(0.1), -0.5, 1]);
	});
});
