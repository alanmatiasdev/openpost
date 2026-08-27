import { describe, expect, it } from 'vitest';
import type { SubtitleCue } from '../project/types';
import { activeWordIndexAtFrame, hasUsableKaraokeTimings, karaokeStateAtFrame } from './karaoke';

function cueWithWords(): SubtitleCue {
	return {
		id: 'c1',
		startFrame: 0,
		endFrame: 60,
		text: 'hello world again',
		words: [
			{ id: 'w1', startFrame: 0, endFrame: 10, text: 'hello' },
			{ id: 'w2', startFrame: 10, endFrame: 20, text: 'world' },
			{ id: 'w3', startFrame: 20, endFrame: 30, text: 'again' }
		]
	};
}

describe('karaoke deterministic active-word boundaries', () => {
	it('uses inclusive start / exclusive end, advancing at the exact boundary', () => {
		const words = cueWithWords().words!;
		expect(activeWordIndexAtFrame(words, -1)).toBe(-1);
		expect(activeWordIndexAtFrame(words, 0)).toBe(0);
		expect(activeWordIndexAtFrame(words, 9)).toBe(0);
		expect(activeWordIndexAtFrame(words, 10)).toBe(1);
		expect(activeWordIndexAtFrame(words, 19)).toBe(1);
		expect(activeWordIndexAtFrame(words, 20)).toBe(2);
		expect(activeWordIndexAtFrame(words, 29)).toBe(2);
		expect(activeWordIndexAtFrame(words, 30)).toBe(-1);
		expect(activeWordIndexAtFrame(words, 60)).toBe(-1);
	});

	it('returns -1 inside gaps between word timings', () => {
		const words = [
			{ id: 'w1', startFrame: 0, endFrame: 10, text: 'hello' },
			{ id: 'w2', startFrame: 12, endFrame: 20, text: 'world' }
		];
		expect(activeWordIndexAtFrame(words, 11)).toBe(-1);
		expect(activeWordIndexAtFrame(words, 12)).toBe(1);
	});

	it('is independent from renderer implementation', () => {
		const cue = cueWithWords();
		// Preview and export both call the same pure helper
		const previewActive = activeWordIndexAtFrame(cue.words, 10);
		const exportActive = activeWordIndexAtFrame(cue.words, 10);
		expect(previewActive).toBe(exportActive);
		expect(previewActive).toBe(1);
	});
});

describe('preview/export parity at boundaries', () => {
	it('resolves the identical active word for preview and export at before/start/middle/end', () => {
		const cue = cueWithWords();
		const itemKaraoke = { captionHighlightMode: 'karaoke' as const };
		const parsed = 'hello world again';
		const frames = [
			{ frame: -1, expected: null },
			{ frame: 0, expected: 0 },
			{ frame: 5, expected: 0 },
			{ frame: 10, expected: 1 },
			{ frame: 15, expected: 1 },
			{ frame: 29, expected: 2 },
			{ frame: 30, expected: null }
		] as const;
		for (const { frame, expected } of frames) {
			const preview = karaokeStateAtFrame(itemKaraoke, cue, parsed, frame);
			const exported = karaokeStateAtFrame(itemKaraoke, cue, parsed, frame);
			if (expected === null) {
				expect(preview).toBeNull();
				expect(exported).toBeNull();
			} else {
				expect(preview?.activeIndex).toBe(expected);
				expect(exported?.activeIndex).toBe(expected);
			}
		}
	});
});

describe('untimed fallback', () => {
	it('falls back to normal caption when cue has no words', () => {
		const cue: SubtitleCue = { id: 'c', startFrame: 0, endFrame: 10, text: 'hello' };
		expect(hasUsableKaraokeTimings(cue, 'hello')).toBe(false);
		expect(karaokeStateAtFrame({ captionHighlightMode: 'karaoke' }, cue, 'hello', 0)).toBeNull();
	});

	it('falls back when word count does not match plain-text tokens', () => {
		const cue: SubtitleCue = {
			id: 'c',
			startFrame: 0,
			endFrame: 10,
			text: 'hello world',
			words: [{ id: 'w1', startFrame: 0, endFrame: 10, text: 'hello' }]
		};
		expect(hasUsableKaraokeTimings(cue, 'hello world')).toBe(false);
	});

	it('falls back when a word timing is invalid (start >= end)', () => {
		const cue: SubtitleCue = {
			id: 'c',
			startFrame: 0,
			endFrame: 10,
			text: 'hello world',
			words: [
				{ id: 'w1', startFrame: 5, endFrame: 5, text: 'hello' },
				{ id: 'w2', startFrame: 6, endFrame: 10, text: 'world' }
			]
		};
		expect(hasUsableKaraokeTimings(cue, 'hello world')).toBe(false);
	});

	it('falls back when token text mismatches word text (edited cue)', () => {
		const cue: SubtitleCue = {
			id: 'c',
			startFrame: 0,
			endFrame: 10,
			text: 'hello world',
			words: [
				{ id: 'w1', startFrame: 0, endFrame: 5, text: 'hello' },
				{ id: 'w2', startFrame: 5, endFrame: 10, text: 'there' }
			]
		};
		expect(hasUsableKaraokeTimings(cue, 'hello world')).toBe(false);
	});

	it('falls back when karaoke mode is not enabled', () => {
		const cue = cueWithWords();
		expect(
			karaokeStateAtFrame({ captionHighlightMode: 'normal' }, cue, 'hello world again', 5)
		).toBeNull();
		expect(karaokeStateAtFrame({}, cue, 'hello world again', 5)).toBeNull();
	});

	it('falls back when no word is active at that frame yet still renders cue', () => {
		const cue = cueWithWords();
		// Before first word or after last word, no highlight but cue still visible as normal
		expect(
			karaokeStateAtFrame({ captionHighlightMode: 'karaoke' }, cue, 'hello world again', -1)
		).toBeNull();
		expect(
			karaokeStateAtFrame({ captionHighlightMode: 'karaoke' }, cue, 'hello world again', 45)
		).toBeNull();
	});
});
