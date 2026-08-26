import { describe, expect, it } from 'vitest';
import {
	boundedLevenshtein,
	findTranscriptWordMatches,
	normalizeTranscriptSearch
} from './fuzzy-search';

describe('transcript fuzzy search', () => {
	it('keeps exact phrase and prefix results precise', () => {
		expect(findTranscriptWordMatches(['Ship', 'the', 'launch', 'today'], 'the lau')).toEqual({
			spans: [{ start: 1, end: 2 }],
			approximate: false
		});
		expect(findTranscriptWordMatches(['Résumé', 'ready'], 'resume')).toEqual({
			spans: [{ start: 0, end: 0 }],
			approximate: false
		});
	});

	it('uses fuzzy matches only after exact matching fails', () => {
		expect(findTranscriptWordMatches(['video', 'vido', 'audio'], 'vidoe')).toEqual({
			spans: [
				{ start: 0, end: 0 },
				{ start: 1, end: 1 }
			],
			approximate: true
		});
		expect(findTranscriptWordMatches(['video', 'vido'], 'vid')).toEqual({
			spans: [
				{ start: 0, end: 0 },
				{ start: 1, end: 1 }
			],
			approximate: false
		});
	});

	it('bounds edit distance work and folds diacritics', () => {
		expect(normalizeTranscriptSearch('AÇÃO')).toBe('acao');
		expect(boundedLevenshtein('launch', 'lunch', 2)).toBe(1);
		expect(boundedLevenshtein('launch', 'different', 2)).toBe(3);
	});
});
