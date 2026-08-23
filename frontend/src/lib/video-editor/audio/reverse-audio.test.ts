import { describe, expect, it } from 'vitest';
import { reverseAudioWindow } from './reverse-audio';

describe('reverseAudioWindow', () => {
	it('copies the exact multi-channel PCM window in reverse frame order', () => {
		const channels = [
			new Float32Array([0, 1, 2, 3, 4, 5]),
			new Float32Array([10, 11, 12, 13, 14, 15])
		];
		const result = reverseAudioWindow(
			{
				length: 6,
				numberOfChannels: 2,
				sampleRate: 2,
				getChannelData: (channel) => channels[channel]!
			},
			2.5,
			1.5
		);

		expect([...result.channels[0]!]).toEqual([4, 3, 2]);
		expect([...result.channels[1]!]).toEqual([14, 13, 12]);
		expect(result.sampleRate).toBe(2);
	});

	it('clamps a window that reaches before the source begins', () => {
		const channel = new Float32Array([1, 2, 3]);
		const result = reverseAudioWindow(
			{
				length: channel.length,
				numberOfChannels: 1,
				sampleRate: 1,
				getChannelData: () => channel
			},
			2,
			5
		);
		expect([...result.channels[0]!]).toEqual([2, 1]);
	});
});
