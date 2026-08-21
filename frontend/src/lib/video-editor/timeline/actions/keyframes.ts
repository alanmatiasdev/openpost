/**
 * Keyframe animation actions and interpolation for timeline items.
 *
 * Keyframe tracks are parallel frame/value arrays stored on the item
 * (`item.keyframes[property]`), so undo/redo captures them through the
 * regular snapshot clone. Frames are relative to item start; interpolation
 * is linear with constant clamping outside the keyed range.
 *
 * Ported from FreeCut (MIT) — types/keyframe.ts and
 * runtime/player/composition/interpolate.ts, trimmed to linear-only,
 * clamped-extrapolation tracks over opacity/volume.
 */

import type {
	ItemKeyframes,
	KeyframeProperty,
	KeyframeTrack,
	TimelineItem
} from '$lib/video-editor/project/types';
import { timelineStore } from '../stores/timeline-store.svelte';
import { execute } from '../commands/command-store.svelte';

/**
 * Interpolate `property` at an item-relative frame. Linear between
 * surrounding keyframes; constant before the first and after the last.
 * Returns null when the item has no track for the property.
 */
export function interpolateAt(
	item: TimelineItem,
	property: KeyframeProperty,
	frame: number
): number | null {
	const track: KeyframeTrack | undefined = item.keyframes?.[property];
	if (!track || track.frames.length === 0) return null;
	const { frames, values } = track;
	if (track.frames.length === 1) return values[0];
	if (frame <= frames[0]) return values[0];
	const last = frames.length - 1;
	if (frame >= frames[last]) return values[last];
	for (let i = 1; i <= last; i++) {
		if (frame <= frames[i]) {
			const t = (frame - frames[i - 1]) / (frames[i] - frames[i - 1]);
			return values[i - 1] + t * (values[i] - values[i - 1]);
		}
	}
	return values[last];
}

/** Interpolate at an absolute timeline frame, converting to item-relative first. */
export function activeValueAt(
	item: TimelineItem,
	property: KeyframeProperty,
	absoluteFrame: number
): number | null {
	return interpolateAt(item, property, absoluteFrame - item.from);
}

/** Insert or replace a keyframe at exactly `frame` as one undoable step. */
export function setKeyframe(
	itemId: string,
	property: KeyframeProperty,
	frame: number,
	value: number
): boolean {
	return execute('SET_KEYFRAME', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item) return false;
		const nextKeyframes = upsertTrack(item.keyframes ?? {}, property, frame, value);
		timelineStore._updateItems([{ id: itemId, patch: { keyframes: nextKeyframes } }]);
		return true;
	});
}

/** Remove the keyframe at exactly `frame`; drops empty tracks. One undoable step. */
export function removeKeyframe(itemId: string, property: KeyframeProperty, frame: number): boolean {
	return execute('REMOVE_KEYFRAME', () => {
		const item = timelineStore.itemById.get(itemId);
		const track = item?.keyframes?.[property];
		if (!item || !track) return false;
		const index = track.frames.indexOf(frame);
		if (index === -1) return false;
		const nextTrack: KeyframeTrack = {
			frames: withoutIndex(track.frames, index),
			values: withoutIndex(track.values, index)
		};
		timelineStore._updateItems([
			{ id: itemId, patch: { keyframes: pruneTrack(item.keyframes ?? {}, property, nextTrack) } }
		]);
		return true;
	});
}

function upsertTrack(
	keyframes: ItemKeyframes,
	property: KeyframeProperty,
	frame: number,
	value: number
): ItemKeyframes {
	const source = keyframes[property];
	const frames = source ? [...source.frames] : [];
	const values = source ? [...source.values] : [];
	const index = frames.indexOf(frame);
	if (index !== -1) {
		values[index] = value;
	} else {
		let insertAt = frames.length;
		for (let i = 0; i < frames.length; i++) {
			if (frame < frames[i]) {
				insertAt = i;
				break;
			}
		}
		frames.splice(insertAt, 0, frame);
		values.splice(insertAt, 0, value);
	}
	return { ...keyframes, [property]: { frames, values } };
}

function pruneTrack(
	keyframes: ItemKeyframes,
	property: KeyframeProperty,
	track: KeyframeTrack
): ItemKeyframes | undefined {
	if (track.frames.length > 0) return { ...keyframes, [property]: track };
	const next: ItemKeyframes = { ...keyframes };
	delete next[property];
	return Object.keys(next).length > 0 ? next : undefined;
}

function withoutIndex(source: number[], index: number): number[] {
	return [...source.slice(0, index), ...source.slice(index + 1)];
}
