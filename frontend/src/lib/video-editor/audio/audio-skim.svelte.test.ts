import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMediaElementAudioSkimEngine } from './audio-skim';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('media element audio skim engine', () => {
	it('seeks, plays one bounded grain, and reuses its media element', async () => {
		const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
		const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
		vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
		const createAudio = vi.fn(() => document.createElement('audio'));
		const engine = createMediaElementAudioSkimEngine({ grainSeconds: 0.045, createAudio });

		const first = engine.scrub({
			url: 'blob:first',
			kind: 'audio',
			timeSeconds: 1.25,
			gain: 0.6
		});
		await first;
		const media = createAudio.mock.results[0]?.value;
		expect(createAudio).toHaveBeenCalledOnce();
		expect(media?.currentTime).toBeCloseTo(1.25, 8);
		expect(media?.volume).toBeCloseTo(0.6, 8);
		expect(play).toHaveBeenCalledOnce();

		await new Promise<void>((resolve) => setTimeout(resolve, 55));
		expect(pause).toHaveBeenCalledTimes(2);

		const second = engine.scrub({
			url: 'blob:first',
			kind: 'audio',
			timeSeconds: 2,
			gain: 0.4
		});
		await second;
		expect(createAudio).toHaveBeenCalledOnce();
		expect(media?.currentTime).toBeCloseTo(2, 8);
		engine.dispose();
	});
});
