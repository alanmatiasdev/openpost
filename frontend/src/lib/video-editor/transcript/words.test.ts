import { describe, expect, it } from 'vitest';
import { mergeChunkWords, wordsToTranscriptText } from './words';
import type { TranscriptWord } from './cues';

function word(text: string, startSeconds: number, endSeconds: number): TranscriptWord {
	return { text, startSeconds, endSeconds };
}

describe('mergeChunkWords', () => {
	it('dedupes the same word appearing inside the overlap zone', () => {
		const left = [word('Hello', 28.0, 28.4), word('world', 29.9, 30.3)];
		const right = [word('world', 29.95, 30.35), word('again', 31, 31.5)];
		const merged = mergeChunkWords(left, right, 2);
		expect(merged.map((w) => w.text)).toEqual(['Hello', 'world', 'again']);
	});

	it('keeps repeated real speech outside the overlap zone', () => {
		const left = [word('yeah', 1, 1.4)];
		const right = [word('yeah', 40, 40.4)];
		const merged = mergeChunkWords(left, right, 2);
		expect(merged.length).toBe(2);
	});

	it('returns copies for empty inputs and sorts by time', () => {
		const later = [word('b', 5, 6)];
		const earlier = [word('a', 1, 2)];
		expect(mergeChunkWords([], later, 1)).toEqual(later);
		expect(mergeChunkWords(earlier, [], 1)).toEqual(earlier);
		expect(mergeChunkWords([later[0]!, earlier[0]!], [], 1)[0]!.text).toBe('a');
	});
});

describe('wordsToTranscriptText', () => {
	it('joins trimmed words with single spaces', () => {
		expect(wordsToTranscriptText([word(' hi ', 0, 1), word('', 1, 1), word('there', 1, 2)])).toBe(
			'hi there'
		);
	});
});
