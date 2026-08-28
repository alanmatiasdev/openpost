import type { SubtitleCue, SubtitleWord } from '../project/types';

function finiteFrame(value: number, fallback: number): number {
	return Number.isFinite(value) ? Math.round(value) : fallback;
}

/** Keep a cue interval finite and non-empty while preserving valid user input. */
export function correctedCueTiming(
	cue: SubtitleCue,
	startFrame: number,
	endFrame: number
): Pick<SubtitleCue, 'startFrame' | 'endFrame'> {
	const start = Math.max(0, finiteFrame(startFrame, cue.startFrame));
	const end = Math.max(start + 1, finiteFrame(endFrame, cue.endFrame));
	return { startFrame: start, endFrame: end };
}

export interface CorrectedWordPatch {
	words: SubtitleWord[];
	startFrame: number;
	endFrame: number;
}

function correctionTokens(plainText: string): string[] {
	const trimmed = plainText.trim();
	return trimmed ? trimmed.split(/\s+/) : [];
}

/**
 * Keep cue-level caption corrections and timed transcript words in sync.
 * Existing word identity and timing survive copy-only corrections. A changed
 * word count is spread over the previous timed span so transcript editing does
 * not keep stale or untimed copy.
 */
export function correctedCueWords(cue: SubtitleCue, plainText: string): SubtitleWord[] | undefined {
	if (!cue.words?.length) return undefined;
	const tokens = correctionTokens(plainText);
	if (tokens.length === 0) return undefined;
	if (tokens.length === cue.words.length) {
		return cue.words.map((word, index) => ({ ...word, text: tokens[index]! }));
	}

	const spanStart = Math.min(...cue.words.map((word) => word.startFrame));
	const spanEnd = Math.max(spanStart + 1, ...cue.words.map((word) => word.endFrame));
	const span = spanEnd - spanStart;
	return tokens.map((text, index) => {
		const startFrame = Math.min(
			spanEnd - 1,
			Math.round(spanStart + (span * index) / tokens.length)
		);
		const endFrame = Math.max(
			startFrame + 1,
			Math.min(spanEnd, Math.round(spanStart + (span * (index + 1)) / tokens.length))
		);
		return {
			id: cue.words?.[index]?.id ?? crypto.randomUUID(),
			startFrame,
			endFrame,
			text
		};
	});
}

/**
 * Apply one word correction without allowing NaN or an inverted word interval
 * into persisted captions. Cue bounds follow the complete corrected word set.
 */
export function correctedSubtitleWord(
	cue: SubtitleCue,
	wordId: string,
	patch: Partial<SubtitleWord>
): CorrectedWordPatch | null {
	if (!cue.words) return null;
	const index = cue.words.findIndex((word) => word.id === wordId);
	if (index < 0) return null;
	const current = cue.words[index]!;
	const startFrame = Math.max(
		0,
		finiteFrame(patch.startFrame ?? current.startFrame, current.startFrame)
	);
	const endFrame = Math.max(
		startFrame + 1,
		finiteFrame(patch.endFrame ?? current.endFrame, current.endFrame)
	);
	const text = patch.text ?? current.text;
	if (text === current.text && startFrame === current.startFrame && endFrame === current.endFrame) {
		return null;
	}

	const words = cue.words.map((word, wordIndex) =>
		wordIndex === index ? { ...word, text, startFrame, endFrame } : { ...word }
	);
	return {
		words,
		startFrame: Math.min(...words.map((word) => word.startFrame)),
		endFrame: Math.max(...words.map((word) => word.endFrame))
	};
}
