import { describe, expect, it } from 'vitest';
import type { SubtitleCue } from '../project/types';
import { correctedCueTiming, correctedSubtitleWord } from './caption-correction';

const cue: SubtitleCue = {
	id: 'cue',
	startFrame: 10,
	endFrame: 50,
	text: 'One two',
	words: [
		{ id: 'one', startFrame: 10, endFrame: 25, text: 'One' },
		{ id: 'two', startFrame: 30, endFrame: 50, text: 'two' }
	]
};

describe('caption correction', () => {
	it('rejects non-finite cue input and keeps intervals non-empty', () => {
		expect(correctedCueTiming(cue, Number.NaN, Number.NaN)).toEqual({
			startFrame: 10,
			endFrame: 50
		});
		expect(correctedCueTiming(cue, 60, 40)).toEqual({ startFrame: 60, endFrame: 61 });
	});

	it('updates word copy and timing while deriving the full cue bounds', () => {
		expect(
			correctedSubtitleWord(cue, 'one', { text: 'First', startFrame: 4, endFrame: 20 })
		).toEqual({
			words: [
				{ id: 'one', startFrame: 4, endFrame: 20, text: 'First' },
				{ id: 'two', startFrame: 30, endFrame: 50, text: 'two' }
			],
			startFrame: 4,
			endFrame: 50
		});
	});

	it('does not persist NaN, inverted intervals, missing words, or no-op edits', () => {
		expect(correctedSubtitleWord(cue, 'one', { startFrame: Number.NaN })).toBeNull();
		expect(correctedSubtitleWord(cue, 'missing', { text: 'Nope' })).toBeNull();
		expect(correctedSubtitleWord(cue, 'one', { startFrame: 40, endFrame: 20 })).toMatchObject({
			words: [
				{ id: 'one', startFrame: 40, endFrame: 41 },
				{ id: 'two', startFrame: 30, endFrame: 50 }
			],
			startFrame: 30,
			endFrame: 50
		});
	});
});
