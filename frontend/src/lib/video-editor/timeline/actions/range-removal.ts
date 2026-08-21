/**
 * Range-removal machinery: convert source-second ranges (silence, filler
 * words, transcript selections) into split frames, remove the covered
 * segments, and ripple the remainder — all as one undo step.
 *
 * A post-split segment is removed when at least SILENCE_COVERAGE_THRESHOLD
 * of its source-time span is covered by a range. The threshold guards both
 * un-splittable partial segments and float rounding at range edges.
 *
 * Ported from FreeCut (MIT) — edit/range-removal-actions.ts, without
 * transitions/keyframes/sync-lock cascades.
 */

import type { TimelineItem } from '$lib/video-editor/project/types';
import { timelineStore } from '../stores/timeline-store.svelte';
import { execute } from '../commands/command-store.svelte';
import {
	expandSelectionWithLinkedItems,
	getUniqueLinkedItemAnchorIds
} from '../utils/linked-items';
import { getItemSourceSpanSeconds, sourceSecondsToTimelineFrame } from '../utils/media-item-frames';

export interface SourceRange {
	start: number;
	end: number;
}

export interface RangeRemovalResult {
	analyzedItemCount: number;
	removedRangeCount: number;
	removedItemCount: number;
	splitCount: number;
}

export const SILENCE_COVERAGE_REMOVAL_THRESHOLD = 0.75;

function isMostlyInsideRanges(
	span: { start: number; end: number },
	ranges: readonly SourceRange[]
): boolean {
	const duration = span.end - span.start;
	if (duration <= 0) return false;
	const covered = ranges.reduce((sum, range) => {
		const overlapStart = Math.max(span.start, range.start);
		const overlapEnd = Math.min(span.end, range.end);
		return sum + Math.max(0, overlapEnd - overlapStart);
	}, 0);
	return covered / duration >= SILENCE_COVERAGE_REMOVAL_THRESHOLD;
}

/**
 * Remove items whose source span is ≥75% covered, then shift later items on
 * the same track left by the removed durations. Items that would land inside
 * another shifted item are dropped entirely (full overlap).
 */
/** Outcome of a ripple removal pass. */
interface RippleRemovalResult {
	removedItemCount: number;
	affectedCount: number;
}

function applyRippleRemoval(idsToRemove: Set<string>): RippleRemovalResult {
	const items = timelineStore.items;
	const remaining = items.filter((item) => !idsToRemove.has(item.id));

	const shiftByItemId = new Map<string, number>();
	for (const item of remaining) {
		const shift = items
			.filter((deleted) => idsToRemove.has(deleted.id))
			.filter(
				(deleted) =>
					deleted.trackId === item.trackId && deleted.from + deleted.durationInFrames <= item.from
			)
			.reduce((sum, deleted) => sum + deleted.durationInFrames, 0);
		if (shift > 0) shiftByItemId.set(item.id, shift);
	}

	const updates: Array<{ id: string; from: number }> = [];
	for (const item of remaining) {
		const shift = shiftByItemId.get(item.id) ?? 0;
		if (shift > 0) updates.push({ id: item.id, from: item.from - shift });
	}

	// Drop fully-covered survivors instead of stacking duplicates.
	const shifted = new Map(updates.map((u) => [u.id, u.from] as const));
	const coveredIds = new Set<string>();
	for (const item of remaining) {
		if (shifted.has(item.id)) continue;
		const itemEnd = item.from + item.durationInFrames;
		for (const other of remaining) {
			const newFrom = shifted.get(other.id);
			if (newFrom === undefined || other.trackId !== item.trackId) continue;
			if (newFrom < itemEnd && newFrom + other.durationInFrames > item.from) {
				coveredIds.add(item.id);
				break;
			}
		}
	}
	const filteredUpdates =
		coveredIds.size > 0 ? updates.filter((u) => !coveredIds.has(u.id)) : updates;

	timelineStore._removeItems([...idsToRemove, ...coveredIds]);
	timelineStore._moveItems(filteredUpdates);
	return {
		removedItemCount: idsToRemove.size + coveredIds.size,
		affectedCount: filteredUpdates.length
	};
}

export function removeTimelineRangesFromItems(
	commandType: 'REMOVE_SILENCE' | 'REMOVE_FILLER_WORDS' | 'REMOVE_TRANSCRIPT_SELECTION',
	itemIds: string[],
	rangesByMediaId: Record<string, SourceRange[]>
): RangeRemovalResult {
	if (itemIds.length === 0) {
		return { analyzedItemCount: 0, removedRangeCount: 0, removedItemCount: 0, splitCount: 0 };
	}

	return execute(commandType, () => {
		const timelineFps = timelineStore.fps;
		const initialItems = timelineStore.items;
		const anchorIds = getUniqueLinkedItemAnchorIds(initialItems, itemIds);
		const anchors = anchorIds
			.map((id) => initialItems.find((item) => item.id === id))
			.filter(
				(item): item is TimelineItem =>
					item !== undefined &&
					(item.type === 'video' || item.type === 'audio') &&
					!!item.mediaId &&
					(rangesByMediaId[item.mediaId]?.length ?? 0) > 0
			);

		if (anchors.length === 0) {
			return { analyzedItemCount: 0, removedRangeCount: 0, removedItemCount: 0, splitCount: 0 };
		}

		const anchorDescriptors = anchors.map((item) => ({
			id: item.id,
			// SAFETY: the anchor filter requires a non-null mediaId.
			mediaId: item.mediaId as string,
			originId: item.originId ?? item.id
		}));

		// Split each anchor (and its linked companions) at every range boundary
		// (descending so earlier splits don't invalidate later frame positions).
		let splitCount = 0;
		for (const anchor of anchors) {
			// SAFETY: the anchor filter requires a non-null mediaId.
			const ranges = rangesByMediaId[anchor.mediaId as string];
			const splitFrames = Array.from(
				new Set(
					ranges.flatMap((range) => [
						sourceSecondsToTimelineFrame(anchor, range.start, timelineFps),
						sourceSecondsToTimelineFrame(anchor, range.end, timelineFps)
					])
				)
			)
				.filter((frame) => {
					const live = timelineStore.itemById.get(anchor.id);
					if (!live) return false;
					return frame > live.from && frame < live.from + live.durationInFrames;
				})
				.sort((a, b) => b - a);

			for (const frame of splitFrames) {
				const anchorResult = timelineStore._splitItem(anchor.id, frame);
				if (!anchorResult) continue;
				splitCount += 1;
				const linkedGroupId = anchorResult.leftItem.linkedGroupId;
				if (!linkedGroupId) continue;
				for (const companion of timelineStore.items) {
					if (companion.linkedGroupId !== linkedGroupId || companion.id === anchor.id) continue;
					if (frame > companion.from && frame < companion.from + companion.durationInFrames) {
						if (timelineStore._splitItem(companion.id, frame)) splitCount += 1;
					}
				}
			}
		}

		// Remove every post-split segment mostly covered by a range.
		const currentItems = timelineStore.items;
		const idsToRemove = new Set<string>();
		let removedRangeCount = 0;
		for (const descriptor of anchorDescriptors) {
			const ranges = rangesByMediaId[descriptor.mediaId];
			for (const candidate of currentItems) {
				if (candidate.type !== 'video' && candidate.type !== 'audio') continue;
				if (candidate.mediaId !== descriptor.mediaId) continue;
				if ((candidate.originId ?? candidate.id) !== descriptor.originId) continue;
				const span = getItemSourceSpanSeconds(candidate, timelineFps);
				if (span !== null && isMostlyInsideRanges(span, ranges)) {
					idsToRemove.add(candidate.id);
					for (const range of ranges) {
						if (range.end > span.start && range.start < span.end) removedRangeCount += 1;
					}
				}
			}
		}

		// Coverage above already catches every aligned piece (video and audio
		// candidates share the media's ranges), so removal is direct — no
		// linked-group expansion, which would blanket-remove whole groups
		// since all split pieces keep the group id.
		const { removedItemCount } = applyRippleRemoval(idsToRemove);

		return { analyzedItemCount: anchors.length, removedRangeCount, removedItemCount, splitCount };
	});
}

export function removeSilenceFromItems(
	itemIds: string[],
	silenceRangesByMediaId: Record<string, SourceRange[]>
): RangeRemovalResult {
	return removeTimelineRangesFromItems('REMOVE_SILENCE', itemIds, silenceRangesByMediaId);
}

export function removeFillerWordsFromItems(
	itemIds: string[],
	fillerRangesByMediaId: Record<string, SourceRange[]>
): RangeRemovalResult {
	return removeTimelineRangesFromItems('REMOVE_FILLER_WORDS', itemIds, fillerRangesByMediaId);
}

export function removeTranscriptRangesFromItems(
	itemIds: string[],
	rangesByMediaId: Record<string, SourceRange[]>
): RangeRemovalResult {
	return removeTimelineRangesFromItems('REMOVE_TRANSCRIPT_SELECTION', itemIds, rangesByMediaId);
}
