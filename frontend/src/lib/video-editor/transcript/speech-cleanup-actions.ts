import type { RangeRemovalResult, SourceRange } from '../timeline/actions/range-removal';
import type { SubtitleCue, TimelineItem } from '../project/types';
import {
	removeFillerWordsFromItems,
	removeSilenceFromItems,
	removeTranscriptRangesFromItems
} from '../timeline/actions/range-removal';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { cueWithoutWords, type FillerRange, type TranscriptSourceWord } from './speech-cleanup';

function mergedFrameRanges(
	ranges: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> {
	const merged: Array<{ start: number; end: number }> = [];
	for (const range of ranges.toSorted((left, right) => left.start - right.start)) {
		if (range.end <= range.start) continue;
		const previous = merged.at(-1);
		if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
		else merged.push({ ...range });
	}
	return merged;
}

function sourceItemForCaption(caption: TimelineItem): TimelineItem | null {
	const clipId = caption.captionSource?.clipId;
	if (!clipId) return null;
	return (
		timelineStore.items.find((item) => item.id === clipId) ??
		timelineStore.items.find((item) => item.originId === clipId) ??
		null
	);
}

function rippleTranscriptCaptions(
	rangesByMediaId: Record<string, SourceRange[]>,
	removedWords: readonly TranscriptSourceWord[] = []
): void {
	const removedIdsBySubtitle = new Map<string, Set<string>>();
	for (const word of removedWords) {
		const ids = removedIdsBySubtitle.get(word.subtitleItemId) ?? new Set<string>();
		ids.add(word.wordId);
		removedIdsBySubtitle.set(word.subtitleItemId, ids);
	}
	const updates: Array<{ id: string; patch: Partial<TimelineItem> }> = [];
	for (const subtitle of timelineStore.items) {
		const source = subtitle.captionSource;
		if (subtitle.type !== 'subtitle' || source?.type !== 'transcript' || !subtitle.cues) continue;
		const sourceRanges = rangesByMediaId[source.mediaId] ?? [];
		if (sourceRanges.length === 0) continue;
		const sourceItem = sourceItemForCaption(subtitle);
		const sourceFps =
			sourceItem?.sourceFps && sourceItem.sourceFps > 0 ? sourceItem.sourceFps : timelineStore.fps;
		const sourceStart = source.sourceStartSeconds ?? (sourceItem?.sourceStart ?? 0) / sourceFps;
		const speed =
			source.playbackSpeed && source.playbackSpeed > 0
				? source.playbackSpeed
				: sourceItem?.speed && sourceItem.speed > 0
					? sourceItem.speed
					: 1;
		const frameRanges = mergedFrameRanges(
			sourceRanges.map((range) => ({
				start: Math.max(0, Math.round(((range.start - sourceStart) * timelineStore.fps) / speed)),
				end: Math.min(
					subtitle.durationInFrames,
					Math.round(((range.end - sourceStart) * timelineStore.fps) / speed)
				)
			}))
		);
		if (frameRanges.length === 0) continue;
		const removedIds = removedIdsBySubtitle.get(subtitle.id) ?? new Set<string>();
		const shiftBefore = (frame: number) =>
			frameRanges.reduce(
				(sum, range) => sum + (range.end <= frame ? range.end - range.start : 0),
				0
			);
		const cues: SubtitleCue[] = [];
		for (const cue of subtitle.cues) {
			const shiftedWords = (cue.words ?? [])
				.filter((word) => !removedIds.has(word.id))
				.map((word) => {
					const shift = shiftBefore(word.startFrame);
					return {
						...word,
						startFrame: Math.max(0, word.startFrame - shift),
						endFrame: Math.max(1, word.endFrame - shift)
					};
				});
			const next = cueWithoutWords(
				{ ...cue, words: shiftedWords },
				new Set(cue.words?.filter((word) => removedIds.has(word.id)).map((word) => word.id) ?? [])
			);
			if (next) cues.push(next);
		}
		const removedFrames = frameRanges.reduce((sum, range) => sum + range.end - range.start, 0);
		updates.push({
			id: subtitle.id,
			patch: {
				cues,
				durationInFrames: Math.max(1, subtitle.durationInFrames - removedFrames)
			}
		});
	}
	if (updates.length > 0) timelineStore._updateItems(updates);
}

function rangesByMediaId(ranges: readonly FillerRange[]) {
	const byMedia: Record<string, SourceRange[]> = {};
	for (const range of ranges) {
		(byMedia[range.mediaId] ??= []).push({ start: range.start, end: range.end });
	}
	return byMedia;
}

export function applyFillerRangeRemoval(
	itemIds: string[],
	ranges: readonly FillerRange[]
): RangeRemovalResult {
	const words = ranges.flatMap((range) => range.words);
	const byMedia = rangesByMediaId(ranges);
	return removeFillerWordsFromItems(itemIds, byMedia, () =>
		rippleTranscriptCaptions(byMedia, words)
	);
}

export function applyTranscriptWordRemoval(
	itemIds: string[],
	words: readonly TranscriptSourceWord[]
): RangeRemovalResult {
	const ranges: Record<string, SourceRange[]> = {};
	for (const word of words) {
		(ranges[word.mediaId] ??= []).push({ start: word.start, end: word.end });
	}
	return removeTranscriptRangesFromItems(itemIds, ranges, () =>
		rippleTranscriptCaptions(ranges, words)
	);
}

export function applySilenceRangeRemoval(
	itemIds: string[],
	rangesByMediaId: Record<string, SourceRange[]>
): RangeRemovalResult {
	return removeSilenceFromItems(itemIds, rangesByMediaId, () =>
		rippleTranscriptCaptions(rangesByMediaId)
	);
}
