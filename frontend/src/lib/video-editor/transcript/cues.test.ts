import { describe, expect, it } from 'vitest';
import { buildCuesFromWords, wordRangesToSourceFrames } from './cues';
import type { TranscriptWord } from './cues';

function words(...pairs: Array<[string, number, number]>): TranscriptWord[] {
	return pairs.map(([text, startSeconds, endSeconds]) => ({ text, startSeconds, endSeconds }));
}

describe('buildCuesFromWords', () => {
	it('groups words into one cue under all limits', () => {
		const cues = buildCuesFromWords(words(['Hello', 0, 0.5], ['world', 0.5, 1]), { fps: 30 });
		expect(cues.length).toBe(1);
		expect(cues[0]!.text).toBe('Hello world');
		expect(cues[0]!.startFrame).toBe(0);
		expect(cues[0]!.endFrame).toBe(30);
		expect(cues[0]!.words).toMatchObject([
			{ text: 'Hello', startFrame: 0, endFrame: 15 },
			{ text: 'world', startFrame: 15, endFrame: 30 }
		]);
	});

	it('breaks cues when the span exceeds max duration', () => {
		const cues = buildCuesFromWords(
			words(
				['a', 0, 1],
				['b', 1, 2],
				['c', 2, 3],
				['d', 3, 4],
				['e', 4, 5],
				['f', 5, 6],
				['g', 6, 7]
			),
			{ fps: 10, maxDurationSeconds: 3 }
		);
		expect(cues.length).toBeGreaterThan(1);
		for (const cue of cues) {
			expect(cue.endFrame - cue.startFrame).toBeLessThanOrEqual(31);
		}
	});

	it('wraps long text into lines and marks overflow', () => {
		const cues = buildCuesFromWords(
			words(
				['supercalifragilisticexpialidocious', 0, 1],
				['supercalifragilisticexpialidocious', 1, 2],
				['supercalifragilisticexpialidocious', 2, 3]
			),
			{ fps: 30, maxCharsPerLine: 10, maxLines: 2 }
		);
		const lines = cues[0]!.text.split('\n');
		expect(lines[2]).toBe('…');
	});

	it('never produces zero-length cues', () => {
		const cues = buildCuesFromWords(words(['hi', 5, 5]), { fps: 24 });
		expect(cues[0]!.endFrame).toBeGreaterThan(cues[0]!.startFrame);
	});
});

describe('wordRangesToSourceFrames', () => {
	it('converts word timings to source frames with offset', () => {
		const ranges = wordRangesToSourceFrames(words(['um', 2, 2.5], ['uh', 4, 4.25]), 20, 1);
		expect(ranges[0]).toEqual({ startFrame: 20, endFrame: 30 });
		expect(ranges[1]).toEqual({ startFrame: 60, endFrame: 65 });
	});
});
