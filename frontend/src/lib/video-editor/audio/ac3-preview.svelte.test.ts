import { afterEach, describe, expect, it } from 'vitest';
import ac3FixtureUrl from '../media/fixtures/tone-ac3.mkv?url';
import { decodedPreviewAudio } from './reverse-preview-audio';

const objectUrls: string[] = [];

afterEach(() => {
	for (const url of objectUrls.splice(0)) URL.revokeObjectURL(url);
});

describe('AC-3 preview decoding', () => {
	it('decodes a real AC-3 source through the lazy Mediabunny decoder', async () => {
		const response = await fetch(ac3FixtureUrl);
		expect(response.ok).toBe(true);
		const url = URL.createObjectURL(await response.blob());
		objectUrls.push(url);

		const decoded = await decodedPreviewAudio(url, 'ac3');

		expect(decoded.sampleRate).toBe(48_000);
		expect(decoded.numberOfChannels).toBeGreaterThan(0);
		expect(decoded.duration).toBeGreaterThan(0.25);
		const peak = decoded
			.getChannelData(0)
			.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
		expect(peak).toBeGreaterThan(0.01);
	});
});
