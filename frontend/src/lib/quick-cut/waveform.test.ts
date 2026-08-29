import { describe, expect, it } from 'vitest';
import { quickCutWaveformKey, sampleWaveformColumns } from './waveform';
import type { QuickCutSource } from './types';

describe('Quick Cut waveform', () => {
	it('keeps short transients when reducing source peaks to screen columns', () => {
		const values = sampleWaveformColumns(
			{
				peaks: new Float32Array([0.1, 0.2, 0.95, 0.1, 0.3, 0.4, 0.2, 0.8]),
				durationSeconds: 2,
				samplesPerSecond: 4,
				loadedSamples: 8,
				isComplete: true
			},
			4,
			2
		);

		expect([...values]).toEqual([
			expect.closeTo(0.2),
			expect.closeTo(0.95),
			expect.closeTo(0.4),
			expect.closeTo(0.8)
		]);
	});

	it('does not draw undecoded progressive samples', () => {
		const values = sampleWaveformColumns(
			{
				peaks: new Float32Array([0.8, 0.4, 0.9, 1]),
				durationSeconds: 4,
				samplesPerSecond: 1,
				loadedSamples: 2,
				isComplete: false
			},
			4,
			4
		);

		expect([...values]).toEqual([expect.closeTo(0.8), expect.closeTo(0.4), 0, 0]);
	});

	it('invalidates cache identity when the source bytes or selected audio track change', () => {
		const source = {
			id: 'source',
			size: 100,
			lastModified: 10,
			contentFingerprint: 'fingerprint',
			audioStreams: [{ index: 0 }, { index: 1 }],
			selectedAudioTrackIndices: [0]
		} as QuickCutSource;

		expect(quickCutWaveformKey(source)).not.toBe(
			quickCutWaveformKey({ ...source, selectedAudioTrackIndices: [1] })
		);
		expect(quickCutWaveformKey(source)).not.toBe(
			quickCutWaveformKey({ ...source, contentFingerprint: 'replacement' })
		);
	});
});
