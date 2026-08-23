/**
 * Linked-group helpers: items joined via `linkedGroupId` (e.g. a video clip
 * with its audio companion) edit as one.
 *
 * Ported from FreeCut (MIT) — utils/linked-items.ts — trimmed to the v1
 * surface: group membership only. FreeCut's legacy auto-link fallback (matching
 * video/audio pairs by originId+mediaId+position for projects that predate
 * `linkedGroupId`) is dropped because OpenPost has no legacy projects; the
 * attached-caption expansion is dropped because captions live on subtitle
 * items in v1 rather than text items bound to clips.
 */

import type { TimelineItem } from '../../project/types';

export function getLinkedItems(items: TimelineItem[], itemId: string): TimelineItem[] {
	const anchor = items.find((item) => item.id === itemId);
	if (!anchor) return [];
	if (!anchor.linkedGroupId) return [anchor];
	return items.filter((item) => item.linkedGroupId === anchor.linkedGroupId);
}

export function getLinkedItemIds(items: TimelineItem[], itemId: string): string[] {
	return getLinkedItems(items, itemId).map((item) => item.id);
}

export function hasLinkedItems(items: TimelineItem[], itemId: string): boolean {
	return getLinkedItemIds(items, itemId).length > 1;
}

/**
 * Return only linked clips that still share one editable media window.
 *
 * A user can unlink clips by editing one side until it diverges. Keeping the
 * synchronization check here prevents later trim, slip, slide, and rate edits
 * from overwriting that intentional offset.
 *
 * Ported from FreeCut (MIT) - timeline/utils/linked-items.ts.
 */
export function getSynchronizedLinkedItems(items: TimelineItem[], itemId: string): TimelineItem[] {
	const linkedItems = getLinkedItems(items, itemId);
	const anchor = linkedItems.find((item) => item.id === itemId);
	if (!anchor) return [];

	return linkedItems.filter(
		(item) =>
			item.id === anchor.id ||
			(item.from === anchor.from &&
				item.durationInFrames === anchor.durationInFrames &&
				(item.sourceStart ?? null) === (anchor.sourceStart ?? null) &&
				(item.sourceEnd ?? null) === (anchor.sourceEnd ?? null) &&
				(item.speed ?? 1) === (anchor.speed ?? 1) &&
				item.isReversed === anchor.isReversed)
	);
}

/** Find synchronized partners for both sides of one cut on the same companion track. */
export function getSynchronizedLinkedCounterpartPair(
	items: TimelineItem[],
	leftId: string,
	rightId: string
): { leftCounterpart: TimelineItem; rightCounterpart: TimelineItem } | null {
	const leftCounterparts = getSynchronizedLinkedItems(items, leftId).filter(
		(item) => item.id !== leftId
	);
	const rightCounterparts = getSynchronizedLinkedItems(items, rightId).filter(
		(item) => item.id !== rightId
	);

	for (const leftCounterpart of leftCounterparts) {
		const rightCounterpart = rightCounterparts.find(
			(item) => item.trackId === leftCounterpart.trackId && item.type === leftCounterpart.type
		);
		if (rightCounterpart) return { leftCounterpart, rightCounterpart };
	}
	return null;
}

/** Collapse a selection to one anchor id per linked group (input order kept). */
export function getUniqueLinkedItemAnchorIds(items: TimelineItem[], itemIds: string[]): string[] {
	const anchors: string[] = [];
	const visitedIds = new Set<string>();

	for (const itemId of itemIds) {
		if (visitedIds.has(itemId)) continue;

		const linkedIds = getLinkedItemIds(items, itemId);
		if (linkedIds.length === 0) continue;

		anchors.push(itemId);
		for (const linkedId of linkedIds) {
			visitedIds.add(linkedId);
		}
	}

	return anchors;
}

export function expandSelectionWithLinkedItems(items: TimelineItem[], itemIds: string[]): string[] {
	const expandedIds = new Set<string>();
	for (const itemId of itemIds) {
		for (const linkedId of getLinkedItemIds(items, itemId)) {
			expandedIds.add(linkedId);
		}
	}
	return Array.from(expandedIds);
}

function isMediaPair(left: TimelineItem, right: TimelineItem): boolean {
	return (
		(left.type === 'video' && right.type === 'audio') ||
		(left.type === 'audio' && right.type === 'video')
	);
}

/**
 * Two solo media items can be linked when they show/play the same window of
 * the same media at the same timeline position — i.e. a freshly imported
 * video/audio pair before any divergent edits.
 */
export function canLinkItems(items: TimelineItem[]): boolean {
	if (items.length !== 2) return false;

	const [left, right] = items;
	if (!left || !right) return false;
	if (!isMediaPair(left, right)) return false;
	if (!left.mediaId || left.mediaId !== right.mediaId) return false;
	if (left.from !== right.from) return false;
	if (left.durationInFrames !== right.durationInFrames) return false;
	if ((left.sourceStart ?? null) !== (right.sourceStart ?? null)) return false;
	if ((left.sourceEnd ?? null) !== (right.sourceEnd ?? null)) return false;

	return true;
}

/**
 * A selection can be linked when it spans at least two items that are not all
 * already part of a single shared linked group.
 */
export function canLinkSelection(items: TimelineItem[], itemIds: string[]): boolean {
	const uniqueSelectedIds = Array.from(new Set(itemIds)).filter((id) =>
		items.some((item) => item.id === id)
	);
	if (uniqueSelectedIds.length < 2) return false;

	const expandedIds = expandSelectionWithLinkedItems(items, uniqueSelectedIds);
	if (expandedIds.length < 2) return false;

	const firstExpandedId = expandedIds[0];
	if (!firstExpandedId) return false;

	const existingLinkedIds = new Set(getLinkedItemIds(items, firstExpandedId));
	return (
		existingLinkedIds.size !== expandedIds.length ||
		expandedIds.some((id) => !existingLinkedIds.has(id))
	);
}
