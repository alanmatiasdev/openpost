import { describe, expect, it } from 'vitest';
import { isAc3AudioCodec } from './ac3-decoder';
import { isAudioCodecSupported } from './audio-codec-support';

describe('audio codec support', () => {
	it('routes every common AC-3 and E-AC-3 spelling to the custom decoder', () => {
		for (const codec of ['ac3', 'ac-3', 'ec3', 'ec-3', 'eac3', 'e-ac-3', 'Dolby Digital Plus']) {
			expect(isAc3AudioCodec(codec), codec).toBe(true);
		}
		expect(isAc3AudioCodec('aac')).toBe(false);
	});

	it('rejects DTS and TrueHD families without rejecting AC-3', () => {
		for (const codec of ['dts', 'dtsc', 'DTS-HD MA', 'truehd', 'mlpa']) {
			expect(isAudioCodecSupported(codec), codec).toBe(false);
		}
		expect(isAudioCodecSupported('ac3')).toBe(true);
		expect(isAudioCodecSupported('eac3')).toBe(true);
		expect(isAudioCodecSupported('aac')).toBe(true);
		expect(isAudioCodecSupported(undefined)).toBe(true);
	});
});
