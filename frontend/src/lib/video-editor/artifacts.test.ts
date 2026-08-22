import { describe, expect, it } from 'vitest';
import { parseSourceArtifactIndex } from './artifacts';

const artifact = {
	version: 6,
	complete: true,
	index_complete: true,
	editor_complete: false,
	source_id: 'source-1',
	duration_us: 1_000_000,
	frame_rate: 30,
	phase: 'ready',
	progress: 1,
	proxy_reason: null,
	proxy_state: 'not-needed',
	proxy_progress: 0,
	keyframes_us: [0, 500_000],
	waveform_peaks: [0.1, 0.5],
	thumbnail_complete: true,
	waveform_complete: true
};

describe('video source artifact storage', () => {
	it('parses a complete persisted artifact', () => {
		expect(parseSourceArtifactIndex(JSON.stringify(artifact))).toEqual(artifact);
	});

	it('rejects malformed persisted fields', () => {
		expect(
			parseSourceArtifactIndex(JSON.stringify({ ...artifact, waveform_peaks: ['0.1'] }))
		).toBeNull();
		expect(parseSourceArtifactIndex(JSON.stringify({ ...artifact, phase: 'unknown' }))).toBeNull();
	});
});
