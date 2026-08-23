/**
 * Keyframe animation actions and interpolation for timeline items.
 *
 * Keyframe tracks are parallel frame/value arrays stored on the item
 * (`item.keyframes[property]`), so undo/redo captures them through the
 * regular snapshot clone. Frames are relative to item start; interpolation
 * applies the outgoing easing stored on the previous keyframe and clamps
 * outside the keyed range.
 *
 * Ported from FreeCut (MIT) - types/keyframe.ts and
 * features/keyframes/utils/interpolation.ts.
 */

import type {
	EasingConfig,
	EasingType,
	ItemKeyframes,
	KeyframeProperty,
	KeyframeTrack,
	TimelineItem
} from '$lib/video-editor/project/types';
import { applyEasing, applyEasingConfig } from '../easing';
import { timelineStore } from '../stores/timeline-store.svelte';
import { execute } from '../commands/command-store.svelte';
import { isFrameInTransitionRegion } from '../edit-constraints';
import { transitionsStore } from './transitions-store.svelte';
import { trackEntryAt, type KeyframeRef } from '../keyframe-editor';

export interface KeyframeEdit {
	ref: KeyframeRef;
	frame: number;
	value: number;
}

function canWriteKeyframe(item: TimelineItem, relativeFrame: number): boolean {
	return (
		Number.isInteger(relativeFrame) &&
		relativeFrame >= 0 &&
		relativeFrame < item.durationInFrames &&
		!isFrameInTransitionRegion(relativeFrame, item, transitionsStore.list)
	);
}

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
			const progress = (frame - frames[i - 1]) / (frames[i] - frames[i - 1]);
			const easingConfig = track.easingConfigs?.[i - 1] ?? undefined;
			const easedProgress = easingConfig
				? applyEasingConfig(progress, easingConfig)
				: applyEasing(progress, track.easings?.[i - 1] ?? 'linear');
			return values[i - 1] + easedProgress * (values[i] - values[i - 1]);
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
		if (!item || !canWriteKeyframe(item, frame)) return false;
		const nextKeyframes = upsertTrack(item.keyframes ?? {}, property, frame, value);
		timelineStore._updateItems([{ id: itemId, patch: { keyframes: nextKeyframes } }]);
		return true;
	});
}

/**
 * Commit an inspector or gizmo value using FreeCut's auto-key rules.
 * Existing animation lanes keep receiving keys. The explicit auto-key flag
 * only controls whether a new lane starts.
 */
export function setAnimatedProperty(
	itemId: string,
	property: KeyframeProperty,
	absoluteFrame: number,
	value: number,
	autoKeyEnabled: boolean
): boolean {
	return execute('SET_ANIMATED_PROPERTY', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item || absoluteFrame < item.from || absoluteFrame >= item.from + item.durationInFrames) {
			return false;
		}
		const relativeFrame = absoluteFrame - item.from;
		const track = item.keyframes?.[property];
		if (track || autoKeyEnabled) {
			if (!canWriteKeyframe(item, relativeFrame)) return false;
			const nextKeyframes = upsertTrack(item.keyframes ?? {}, property, relativeFrame, value);
			timelineStore._updateItems([{ id: itemId, patch: { keyframes: nextKeyframes } }]);
			return true;
		}
		timelineStore._updateItems([{ id: itemId, patch: basePropertyPatch(item, property, value) }]);
		return true;
	});
}

/** Commit several inspector or gizmo values as one undo entry. */
export function setAnimatedProperties(
	itemId: string,
	absoluteFrame: number,
	values: Partial<Record<KeyframeProperty, number>>,
	isAutoKeyEnabled: (property: KeyframeProperty) => boolean
): boolean {
	return execute('SET_ANIMATED_PROPERTIES', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item || absoluteFrame < item.from || absoluteFrame >= item.from + item.durationInFrames) {
			return false;
		}
		let keyframes = item.keyframes;
		let patch: Partial<TimelineItem> = {};
		const relativeFrame = absoluteFrame - item.from;
		const shouldWriteKey = Object.entries(values).some(([rawProperty, value]) => {
			if (value === undefined) return false;
			// SAFETY: values is keyed by KeyframeProperty at the public boundary.
			const property = rawProperty as KeyframeProperty;
			return item.keyframes?.[property] !== undefined || isAutoKeyEnabled(property);
		});
		if (shouldWriteKey && !canWriteKeyframe(item, relativeFrame)) return false;
		for (const [rawProperty, value] of Object.entries(values)) {
			if (value === undefined) continue;
			// SAFETY: values is keyed by KeyframeProperty at the public boundary.
			const property = rawProperty as KeyframeProperty;
			if (item.keyframes?.[property] || isAutoKeyEnabled(property)) {
				keyframes = upsertTrack(keyframes ?? {}, property, relativeFrame, value);
			} else {
				patch = mergeItemPatches(patch, basePropertyPatch({ ...item, ...patch }, property, value));
			}
		}
		if (keyframes !== item.keyframes) patch.keyframes = keyframes;
		timelineStore._updateItems([{ id: itemId, patch }]);
		return true;
	});
}

/** Change the outgoing interpolation for the segment that starts at `frame`. */
export function setKeyframeEasing(
	itemId: string,
	property: KeyframeProperty,
	frame: number,
	easing: EasingType,
	easingConfig?: EasingConfig
): boolean {
	return execute('SET_KEYFRAME_EASING', () => {
		const item = timelineStore.itemById.get(itemId);
		const track = item?.keyframes?.[property];
		if (!item || !track) return false;
		const index = track.frames.indexOf(frame);
		if (index === -1) return false;

		const nextTrack = withCompleteMetadata(track);
		nextTrack.easings[index] = easing;
		nextTrack.easingConfigs[index] = easingConfig ?? null;
		timelineStore._updateItems([
			{
				id: itemId,
				patch: { keyframes: { ...item.keyframes, [property]: nextTrack } }
			}
		]);
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
			values: withoutIndex(track.values, index),
			...(track.ids && { ids: withoutIndex(track.ids, index) }),
			...(track.easings && { easings: withoutIndex(track.easings, index) }),
			...(track.easingConfigs && {
				easingConfigs: withoutIndex(track.easingConfigs, index)
			})
		};
		timelineStore._updateItems([
			{ id: itemId, patch: { keyframes: pruneTrack(item.keyframes ?? {}, property, nextTrack) } }
		]);
		return true;
	});
}

/** Move or edit several keyframes as one collision-safe undo step. */
export function updateKeyframes(itemId: string, edits: readonly KeyframeEdit[]): boolean {
	return execute('UPDATE_KEYFRAMES', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item || edits.length === 0) return false;
		if (edits.some((edit) => !canWriteKeyframe(item, edit.frame) || !Number.isFinite(edit.value))) {
			return false;
		}

		const byProperty = Map.groupBy(edits, (edit) => edit.ref.property);
		const keyframes: ItemKeyframes = { ...item.keyframes };
		for (const [property, propertyEdits] of byProperty) {
			const source = item.keyframes?.[property];
			if (!source) return false;
			const track = withCompleteMetadata(source);
			const targets = new Set<number>();
			const editById = new Map<string, KeyframeEdit>();
			for (const edit of propertyEdits) {
				const index = trackEntryAt(track, edit.ref);
				if (index < 0 || targets.has(edit.frame)) return false;
				targets.add(edit.frame);
				const id = track.ids[index];
				if (!id) return false;
				editById.set(id, edit);
			}

			const entries = track.frames.map((frame, index) => {
				const id = track.ids[index] ?? crypto.randomUUID();
				const edit = editById.get(id);
				return {
					id,
					frame: edit?.frame ?? frame,
					value: edit?.value ?? track.values[index] ?? 0,
					easing: track.easings[index] ?? 'linear',
					easingConfig: track.easingConfigs[index] ?? null,
					isEdited: edit !== undefined
				};
			});
			const byFrame = new Map<number, (typeof entries)[number]>();
			for (const entry of entries) {
				const existing = byFrame.get(entry.frame);
				if (!existing || entry.isEdited) byFrame.set(entry.frame, entry);
			}
			const sorted = [...byFrame.values()].toSorted((left, right) => left.frame - right.frame);
			keyframes[property] = {
				frames: sorted.map((entry) => entry.frame),
				values: sorted.map((entry) => entry.value),
				ids: sorted.map((entry) => entry.id),
				easings: sorted.map((entry) => entry.easing),
				easingConfigs: sorted.map((entry) => entry.easingConfig)
			};
		}
		timelineStore._updateItems([{ id: itemId, patch: { keyframes } }]);
		return true;
	});
}

/** Duplicate keyframes to explicit graph targets, preserving their easing. */
export function duplicateKeyframes(itemId: string, edits: readonly KeyframeEdit[]): boolean {
	return execute('DUPLICATE_KEYFRAMES', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item || edits.length === 0) return false;
		if (edits.some((edit) => !canWriteKeyframe(item, edit.frame) || !Number.isFinite(edit.value))) {
			return false;
		}
		let keyframes: ItemKeyframes = { ...item.keyframes };
		for (const edit of edits) {
			const source = keyframes[edit.ref.property];
			if (!source) return false;
			const track = withCompleteMetadata(source);
			const sourceIndex = trackEntryAt(track, edit.ref);
			if (sourceIndex < 0) return false;
			const targetIndex = track.frames.indexOf(edit.frame);
			if (targetIndex >= 0) {
				track.values[targetIndex] = edit.value;
				track.easings[targetIndex] = track.easings[sourceIndex] ?? 'linear';
				track.easingConfigs[targetIndex] = track.easingConfigs[sourceIndex] ?? null;
			} else {
				let insertAt = track.frames.findIndex((frame) => frame > edit.frame);
				if (insertAt < 0) insertAt = track.frames.length;
				track.frames.splice(insertAt, 0, edit.frame);
				track.values.splice(insertAt, 0, edit.value);
				track.ids.splice(insertAt, 0, crypto.randomUUID());
				track.easings.splice(insertAt, 0, track.easings[sourceIndex] ?? 'linear');
				track.easingConfigs.splice(
					insertAt,
					0,
					cloneEasingConfig(track.easingConfigs[sourceIndex] ?? null)
				);
			}
			keyframes = { ...keyframes, [edit.ref.property]: track };
		}
		timelineStore._updateItems([{ id: itemId, patch: { keyframes } }]);
		return true;
	});
}

function cloneEasingConfig(config: EasingConfig | null): EasingConfig | null {
	if (!config) return null;
	return {
		...config,
		...(config.bezier && { bezier: { ...config.bezier } }),
		...(config.spring && { spring: { ...config.spring } })
	};
}

/** Remove an arbitrary selection as one undo step. */
export function removeKeyframes(itemId: string, refs: readonly KeyframeRef[]): boolean {
	return execute('REMOVE_KEYFRAMES', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item || refs.length === 0) return false;
		let keyframes = item.keyframes;
		for (const [property, propertyRefs] of Map.groupBy(refs, (ref) => ref.property)) {
			const source = keyframes?.[property];
			if (!source) continue;
			const indexes = new Set(
				propertyRefs.map((ref) => trackEntryAt(source, ref)).filter((index) => index >= 0)
			);
			if (indexes.size === 0) continue;
			const keep = source.frames.map((_, index) => index).filter((index) => !indexes.has(index));
			const nextTrack: KeyframeTrack = {
				frames: keep.map((index) => source.frames[index] ?? 0),
				values: keep.map((index) => source.values[index] ?? 0),
				...(source.ids && { ids: keep.map((index) => source.ids?.[index] ?? crypto.randomUUID()) }),
				...(source.easings && {
					easings: keep.map((index) => source.easings?.[index] ?? 'linear')
				}),
				...(source.easingConfigs && {
					easingConfigs: keep.map((index) => source.easingConfigs?.[index] ?? null)
				})
			};
			keyframes = pruneTrack(keyframes ?? {}, property, nextTrack);
		}
		if (keyframes === item.keyframes) return false;
		timelineStore._updateItems([{ id: itemId, patch: { keyframes } }]);
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
	const complete = withCompleteMetadata(source ?? { frames: [], values: [] });
	const { frames, values, ids, easings, easingConfigs } = complete;
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
		ids.splice(insertAt, 0, crypto.randomUUID());
		easings.splice(insertAt, 0, 'linear');
		easingConfigs.splice(insertAt, 0, null);
	}
	return {
		...keyframes,
		[property]: { frames, values, ids, easings, easingConfigs }
	};
}

function withCompleteMetadata(track: KeyframeTrack): Required<KeyframeTrack> {
	return {
		frames: [...track.frames],
		values: [...track.values],
		ids: track.frames.map((_, index) => track.ids?.[index] ?? crypto.randomUUID()),
		easings: track.frames.map((_, index) => track.easings?.[index] ?? 'linear'),
		easingConfigs: track.frames.map((_, index) => track.easingConfigs?.[index] ?? null)
	};
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

function withoutIndex<T>(source: T[], index: number): T[] {
	return [...source.slice(0, index), ...source.slice(index + 1)];
}

function basePropertyPatch(
	item: TimelineItem,
	property: KeyframeProperty,
	value: number
): Partial<TimelineItem> {
	if (
		[
			'x',
			'y',
			'width',
			'height',
			'anchorX',
			'anchorY',
			'rotation',
			'opacity',
			'cornerRadius'
		].includes(property)
	) {
		return { transform: { ...item.transform, [property]: value } };
	}
	const crop = item.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
	if (property.startsWith('crop')) {
		const field = property.slice(4).toLowerCase();
		return { crop: { ...crop, [field]: value } };
	}
	if (property.startsWith('textShadow')) {
		const field = property.slice('textShadow'.length);
		const key = `${field.slice(0, 1).toLowerCase()}${field.slice(1)}`;
		return {
			textShadow: {
				...(item.textShadow ?? { blur: 0, color: '#000000', offsetX: 0, offsetY: 0 }),
				[key]: value
			}
		};
	}
	return { [property]: value };
}

function mergeItemPatches(
	left: Partial<TimelineItem>,
	right: Partial<TimelineItem>
): Partial<TimelineItem> {
	const merged: Partial<TimelineItem> = { ...left, ...right };
	if (left.transform || right.transform) {
		merged.transform = { ...left.transform, ...right.transform };
	}
	if (left.crop || right.crop) {
		merged.crop = {
			top: right.crop?.top ?? left.crop?.top ?? 0,
			right: right.crop?.right ?? left.crop?.right ?? 0,
			bottom: right.crop?.bottom ?? left.crop?.bottom ?? 0,
			left: right.crop?.left ?? left.crop?.left ?? 0,
			softness: right.crop?.softness ?? left.crop?.softness
		};
	}
	if (left.textShadow || right.textShadow) {
		merged.textShadow = {
			blur: right.textShadow?.blur ?? left.textShadow?.blur ?? 0,
			color: right.textShadow?.color ?? left.textShadow?.color ?? '#000000',
			offsetX: right.textShadow?.offsetX ?? left.textShadow?.offsetX ?? 0,
			offsetY: right.textShadow?.offsetY ?? left.textShadow?.offsetY ?? 0
		};
	}
	return merged;
}
