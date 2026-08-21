/**
 * Snapshot capture/restore/equality over the timeline store.
 *
 * All store updates happen synchronously so undo/redo never exposes
 * intermediate states. Equality uses reference comparison — actions must
 * replace arrays/objects rather than mutate them in place for history
 * deduplication to work (the private mutators re-index and mark dirty but
 * the action layer replaces `items` via `_setItems` when shapes change).
 *
 * Ported from FreeCut (MIT) — commands/snapshot.ts.
 */

import { timelineStore } from '../stores/timeline-store.svelte';
import { sanitizeInOutPoints } from '../utils/in-out-points';
import type { TimelineSnapshot } from './types';

export function captureSnapshot(): TimelineSnapshot {
	// Deep-copy items/tracks: the store mutates item objects in place during
	// edits (e.g. _splitItem shrinks the left piece), which would otherwise
	// corrupt captured snapshots sharing those references.
	return {
		items: structuredClone(timelineStore.items),
		tracks: structuredClone(timelineStore.tracks),
		inPoint: timelineStore.inPoint,
		outPoint: timelineStore.outPoint,
		fps: timelineStore.fps,
		scrollPosition: timelineStore.scrollPosition,
		snapEnabled: timelineStore.snapEnabled,
		currentFrame: timelineStore.currentFrame
	};
}

export function restoreSnapshot(snapshot: TimelineSnapshot): void {
	const sanitized = sanitizeInOutPoints({
		inPoint: snapshot.inPoint,
		outPoint: snapshot.outPoint,
		maxFrame: snapshot.items.reduce(
			(max, item) => Math.max(max, item.from + item.durationInFrames),
			0
		)
	});
	timelineStore.setAll({
		items: snapshot.items,
		tracks: snapshot.tracks,
		inPoint: sanitized.inPoint,
		outPoint: sanitized.outPoint,
		currentFrame: snapshot.currentFrame,
		fps: snapshot.fps
	});
	timelineStore._setScrollPosition(snapshot.scrollPosition);
	timelineStore._setSnapEnabled(snapshot.snapEnabled);
}

export function snapshotsEqual(a: TimelineSnapshot, b: TimelineSnapshot): boolean {
	// Snapshots are deep copies (captureSnapshot clones), so equality is
	// structural: JSON comparison keeps history dedup honest despite the
	// store mutating item objects in place during edits.
	return (
		JSON.stringify(a.items) === JSON.stringify(b.items) &&
		JSON.stringify(a.tracks) === JSON.stringify(b.tracks) &&
		a.inPoint === b.inPoint &&
		a.outPoint === b.outPoint &&
		a.fps === b.fps &&
		a.scrollPosition === b.scrollPosition &&
		a.snapEnabled === b.snapEnabled &&
		a.currentFrame === b.currentFrame
	);
}
