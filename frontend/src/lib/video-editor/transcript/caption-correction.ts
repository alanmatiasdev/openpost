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
