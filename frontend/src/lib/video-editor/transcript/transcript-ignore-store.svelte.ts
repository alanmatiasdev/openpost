import type { SourceRange } from '../timeline/actions/range-removal';
import type { TranscriptSourceWord } from './speech-cleanup';

export interface TranscriptIgnoreRanges {
	[mediaId: string]: SourceRange[];
}

const RANGE_EPSILON = 1e-6;

export function normalizeTranscriptIgnoreRanges(ranges: readonly SourceRange[]): SourceRange[] {
	const normalized: SourceRange[] = [];
	for (const range of ranges.toSorted((left, right) => left.start - right.start)) {
		if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start)
			continue;
		const next = { start: Math.max(0, range.start), end: range.end };
		const previous = normalized.at(-1);
		if (previous && next.start <= previous.end + RANGE_EPSILON) {
			previous.end = Math.max(previous.end, next.end);
		} else {
			normalized.push(next);
		}
	}
	return normalized;
}

export function subtractTranscriptIgnoreRanges(
	base: readonly SourceRange[],
	remove: readonly SourceRange[]
): SourceRange[] {
	let result = normalizeTranscriptIgnoreRanges(base);
	for (const cut of normalizeTranscriptIgnoreRanges(remove)) {
		result = result.flatMap((range) => {
			if (cut.end <= range.start || cut.start >= range.end) return [range];
			const pieces: SourceRange[] = [];
			if (cut.start > range.start + RANGE_EPSILON)
				pieces.push({ start: range.start, end: Math.min(cut.start, range.end) });
			if (cut.end < range.end - RANGE_EPSILON)
				pieces.push({ start: Math.max(cut.end, range.start), end: range.end });
			return pieces;
		});
	}
	return result;
}

export function isTranscriptWordIgnored(
	word: Pick<TranscriptSourceWord, 'mediaId' | 'start' | 'end'>,
	ranges: TranscriptIgnoreRanges
): boolean {
	const duration = word.end - word.start;
	if (duration <= 0) return false;
	const covered = (ranges[word.mediaId] ?? []).reduce((total, range) => {
		return total + Math.max(0, Math.min(word.end, range.end) - Math.max(word.start, range.start));
	}, 0);
	return covered / duration >= 0.5;
}

function rangesForWords(words: readonly TranscriptSourceWord[]): TranscriptIgnoreRanges {
	const ranges: TranscriptIgnoreRanges = {};
	for (const word of words) {
		(ranges[word.mediaId] ??= []).push({ start: word.start, end: word.end });
	}
	return ranges;
}

class TranscriptIgnoreStore {
	ranges = $state<TranscriptIgnoreRanges>({});

	ignore(words: readonly TranscriptSourceWord[]): void {
		const additions = rangesForWords(words);
		const next: TranscriptIgnoreRanges = { ...this.ranges };
		for (const [mediaId, ranges] of Object.entries(additions)) {
			next[mediaId] = normalizeTranscriptIgnoreRanges([...(next[mediaId] ?? []), ...ranges]);
		}
		this.ranges = next;
	}

	restore(words: readonly TranscriptSourceWord[]): void {
		const removals = rangesForWords(words);
		const next: TranscriptIgnoreRanges = { ...this.ranges };
		for (const [mediaId, ranges] of Object.entries(removals)) {
			const remaining = subtractTranscriptIgnoreRanges(next[mediaId] ?? [], ranges);
			if (remaining.length === 0) delete next[mediaId];
			else next[mediaId] = remaining;
		}
		this.ranges = next;
	}

	clear(): void {
		this.ranges = {};
	}

	isIgnored(word: Pick<TranscriptSourceWord, 'mediaId' | 'start' | 'end'>): boolean {
		return isTranscriptWordIgnored(word, this.ranges);
	}

	get spanCount(): number {
		return Object.values(this.ranges).reduce((total, ranges) => total + ranges.length, 0);
	}

	get durationSeconds(): number {
		return Object.values(this.ranges).reduce(
			(total, ranges) =>
				total + ranges.reduce((sum, range) => sum + Math.max(0, range.end - range.start), 0),
			0
		);
	}

	__resetForTesting(): void {
		this.clear();
	}
}

export const transcriptIgnoreStore = new TranscriptIgnoreStore();
