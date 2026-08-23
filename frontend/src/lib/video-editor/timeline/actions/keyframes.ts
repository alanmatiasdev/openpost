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
	SpatialBezierTangents,
	TimelineItem,
	VectorKeyframe
} from '$lib/video-editor/project/types';
import { timelineStore } from '../stores/timeline-store.svelte';
import { keyframeSelectionStore } from '../stores/keyframe-selection-store.svelte';
import { execute } from '../commands/command-store.svelte';
import { isFrameInTransitionRegion } from '../edit-constraints';
import { transitionsStore } from './transitions-store.svelte';
import { legacyKeyframeId, trackEntryAt, type KeyframeRef } from '../keyframe-editor';
import {
	activePositionKeyframes,
	cloneVectorKeyframe,
	defaultSpatialTangents,
	interpolatePosition,
	promotePositionKeyframes,
	upsertPositionKeyframe,
	vectorKeyframesPatch
} from '../vector-keyframes';
export { activeValueAt, interpolateAt } from '../keyframe-interpolation';

export interface KeyframeEdit {
	ref: KeyframeRef;
	frame: number;
	value: number;
}

export interface KeyframeInsert {
	property: KeyframeProperty;
	frame: number;
	value: number;
	easing?: EasingType;
	easingConfig?: EasingConfig;
	vectorGroupId?: string;
	spatial?: SpatialBezierTangents;
}

function canWriteKeyframe(item: TimelineItem, relativeFrame: number): boolean {
	return (
		Number.isInteger(relativeFrame) &&
		relativeFrame >= 0 &&
		relativeFrame < item.durationInFrames &&
		!isFrameInTransitionRegion(relativeFrame, item, transitionsStore.list)
	);
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
		if (property === 'x' || property === 'y') {
			const promoted = promotePositionKeyframes(item, frame);
			if (!promoted) return false;
			remapPromotedSelection(itemId, promoted.identityRemap);
			const current = interpolatePosition(promoted.position, frame) ?? {
				x: item.transform?.x ?? 0,
				y: item.transform?.y ?? 0
			};
			const position = upsertPositionKeyframe(promoted.position, frame, {
				...current,
				[property]: value
			});
			timelineStore._updateItems([{ id: itemId, patch: vectorKeyframesPatch(item, position) }]);
			return true;
		}
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
		const hasVectorPosition = Boolean(activePositionKeyframes(item));
		if ((property === 'x' || property === 'y') && (hasVectorPosition || track || autoKeyEnabled)) {
			if (!canWriteKeyframe(item, relativeFrame)) return false;
			const promoted = promotePositionKeyframes(item, relativeFrame);
			if (!promoted) return false;
			remapPromotedSelection(itemId, promoted.identityRemap);
			const current = interpolatePosition(promoted.position, relativeFrame) ?? {
				x: item.transform?.x ?? 0,
				y: item.transform?.y ?? 0
			};
			const position = upsertPositionKeyframe(promoted.position, relativeFrame, {
				...current,
				[property]: value
			});
			timelineStore._updateItems([{ id: itemId, patch: vectorKeyframesPatch(item, position) }]);
			return true;
		}
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
		const hasPositionValue = values.x !== undefined || values.y !== undefined;
		const shouldWritePosition =
			hasPositionValue &&
			(Boolean(activePositionKeyframes(item)) ||
				Boolean(item.keyframes?.x || item.keyframes?.y) ||
				(values.x !== undefined && isAutoKeyEnabled('x')) ||
				(values.y !== undefined && isAutoKeyEnabled('y')));
		const shouldWriteKey = Object.entries(values).some(([rawProperty, value]) => {
			if (value === undefined) return false;
			// SAFETY: values is keyed by KeyframeProperty at the public boundary.
			const property = rawProperty as KeyframeProperty;
			return (
				((property === 'x' || property === 'y') && shouldWritePosition) ||
				item.keyframes?.[property] !== undefined ||
				isAutoKeyEnabled(property)
			);
		});
		if (shouldWriteKey && !canWriteKeyframe(item, relativeFrame)) return false;
		if (shouldWritePosition) {
			const promoted = promotePositionKeyframes(item, relativeFrame);
			if (!promoted) return false;
			remapPromotedSelection(itemId, promoted.identityRemap);
			const current = interpolatePosition(promoted.position, relativeFrame) ?? {
				x: item.transform?.x ?? 0,
				y: item.transform?.y ?? 0
			};
			const position = upsertPositionKeyframe(promoted.position, relativeFrame, {
				x: values.x ?? current.x,
				y: values.y ?? current.y
			});
			patch = { ...patch, ...vectorKeyframesPatch(item, position) };
			keyframes = patch.keyframes;
		}
		for (const [rawProperty, value] of Object.entries(values)) {
			if (value === undefined) continue;
			// SAFETY: values is keyed by KeyframeProperty at the public boundary.
			const property = rawProperty as KeyframeProperty;
			if (shouldWritePosition && (property === 'x' || property === 'y')) continue;
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

/**
 * Edit a position-path point as one atomic X/Y operation. Once either axis has
 * position animation, both axes receive a key so the point remains a vector.
 */
export function setPositionAtFrame(
	itemId: string,
	absoluteFrame: number,
	x: number,
	y: number
): boolean {
	return execute('SET_POSITION_AT_FRAME', () => {
		const item = timelineStore.itemById.get(itemId);
		if (
			!item ||
			!Number.isFinite(x) ||
			!Number.isFinite(y) ||
			absoluteFrame < item.from ||
			absoluteFrame >= item.from + item.durationInFrames
		)
			return false;
		const relativeFrame = absoluteFrame - item.from;
		if (!canWriteKeyframe(item, relativeFrame)) return false;
		const hasPositionAnimation = Boolean(
			activePositionKeyframes(item) || item.keyframes?.x || item.keyframes?.y
		);
		if (!hasPositionAnimation) {
			timelineStore._updateItems([
				{ id: itemId, patch: { transform: { ...item.transform, x, y } } }
			]);
			return true;
		}
		const promoted = promotePositionKeyframes(item, relativeFrame);
		if (!promoted) return false;
		remapPromotedSelection(itemId, promoted.identityRemap);
		const position = upsertPositionKeyframe(promoted.position, relativeFrame, { x, y });
		timelineStore._updateItems([{ id: itemId, patch: vectorKeyframesPatch(item, position) }]);
		return true;
	});
}

/** Add smooth spatial handles to an existing position point. */
export function createPositionSpatialTangents(itemId: string, absoluteFrame: number): boolean {
	return execute('CREATE_POSITION_SPATIAL_TANGENTS', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item) return false;
		const relativeFrame = absoluteFrame - item.from;
		if (!canWriteKeyframe(item, relativeFrame)) return false;
		const promoted = promotePositionKeyframes(item);
		if (!promoted) return false;
		remapPromotedSelection(itemId, promoted.identityRemap);
		const index = promoted.position.findIndex((keyframe) => keyframe.frame === relativeFrame);
		if (index < 0) return false;
		const spatial = defaultSpatialTangents(promoted.position, index);
		if (!spatial) return false;
		const position = promoted.position.map((keyframe, keyframeIndex) =>
			keyframeIndex === index ? { ...keyframe, spatial } : keyframe
		);
		timelineStore._updateItems([{ id: itemId, patch: vectorKeyframesPatch(item, position) }]);
		return true;
	});
}

/** Commit a spatial-handle drag as one undoable edit. */
export function setPositionSpatialTangents(
	itemId: string,
	absoluteFrame: number,
	spatial: SpatialBezierTangents
): boolean {
	return execute('SET_POSITION_SPATIAL_TANGENTS', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item) return false;
		const relativeFrame = absoluteFrame - item.from;
		if (!canWriteKeyframe(item, relativeFrame)) return false;
		const position = activePositionKeyframes(item)?.map(cloneVectorKeyframe);
		if (!position) return false;
		const index = position.findIndex((keyframe) => keyframe.frame === relativeFrame);
		const keyframe = position[index];
		if (!keyframe) return false;
		position[index] = {
			...keyframe,
			spatial: {
				...spatial,
				inTangent: { ...spatial.inTangent },
				outTangent: { ...spatial.outTangent }
			}
		};
		timelineStore._updateItems([{ id: itemId, patch: vectorKeyframesPatch(item, position) }]);
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
		const vectorPosition = item ? activePositionKeyframes(item) : undefined;
		if (item && vectorPosition && (property === 'x' || property === 'y')) {
			const position = vectorPosition.map(cloneVectorKeyframe);
			const index = position?.findIndex((keyframe) => keyframe.frame === frame) ?? -1;
			const keyframe = position?.[index];
			if (!position || !keyframe) return false;
			const nextKeyframe = { ...keyframe, easing };
			if (easingConfig) nextKeyframe.easingConfig = cloneEasingConfig(easingConfig) ?? undefined;
			else delete nextKeyframe.easingConfig;
			position[index] = nextKeyframe;
			timelineStore._updateItems([{ id: itemId, patch: vectorKeyframesPatch(item, position) }]);
			return true;
		}
		const track = item?.keyframes?.[property];
		if (!item || !track) return false;
		const index = track.frames.indexOf(frame);
		if (index === -1) return false;

		const nextTrack = withCompleteMetadata(track, property);
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
		const vectorPosition = item ? activePositionKeyframes(item) : undefined;
		if (item && vectorPosition && (property === 'x' || property === 'y')) {
			const source = vectorPosition;
			const position = source.filter((keyframe) => keyframe.frame !== frame);
			if (position.length === source.length) return false;
			timelineStore._updateItems([{ id: itemId, patch: vectorKeyframesPatch(item, position) }]);
			return true;
		}
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

		const positionSource = activePositionKeyframes(item);
		const vectorEdits = positionSource
			? edits.filter((edit) => vectorIdForRef(positionSource, edit.ref) !== null)
			: [];
		const scalarEdits = edits.filter((edit) => !vectorEdits.includes(edit));
		let patch: Partial<TimelineItem> = {};
		if (positionSource && vectorEdits.length > 0) {
			const position = updatePositionKeyframes(positionSource, vectorEdits);
			if (!position) return false;
			patch = { ...patch, ...vectorKeyframesPatch(item, position) };
		}

		const byProperty = Map.groupBy(scalarEdits, (edit) => edit.ref.property);
		const keyframes: ItemKeyframes = { ...(patch.keyframes ?? item.keyframes) };
		for (const [property, propertyEdits] of byProperty) {
			const source = item.keyframes?.[property];
			if (!source) return false;
			const track = withCompleteMetadata(source, property);
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
		if (scalarEdits.length > 0) patch.keyframes = keyframes;
		timelineStore._updateItems([{ id: itemId, patch }]);
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
		const positionSource = activePositionKeyframes(item);
		const vectorEdits = positionSource
			? edits.filter((edit) => vectorIdForRef(positionSource, edit.ref) !== null)
			: [];
		const scalarEdits = edits.filter((edit) => !vectorEdits.includes(edit));
		let patch: Partial<TimelineItem> = {};
		if (positionSource && vectorEdits.length > 0) {
			const position = duplicatePositionKeyframes(positionSource, vectorEdits);
			if (!position) return false;
			patch = { ...patch, ...vectorKeyframesPatch(item, position) };
		}
		let keyframes: ItemKeyframes = { ...(patch.keyframes ?? item.keyframes) };
		for (const edit of scalarEdits) {
			const source = keyframes[edit.ref.property];
			if (!source) return false;
			const track = withCompleteMetadata(source, edit.ref.property);
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
		if (scalarEdits.length > 0) patch.keyframes = keyframes;
		timelineStore._updateItems([{ id: itemId, patch }]);
		return true;
	});
}

/** Insert or replace several clipboard keyframes as one undo step. */
export function insertKeyframes(itemId: string, inserts: readonly KeyframeInsert[]): KeyframeRef[] {
	return execute('INSERT_KEYFRAMES', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item || inserts.length === 0) return [];
		if (
			inserts.some(
				(insert) => !canWriteKeyframe(item, insert.frame) || !Number.isFinite(insert.value)
			)
		) {
			return [];
		}

		const refsByInsert = new Map<KeyframeInsert, KeyframeRef>();
		const shouldUseVectorPosition =
			Boolean(activePositionKeyframes(item)) || inserts.some((insert) => insert.vectorGroupId);
		const vectorInserts = shouldUseVectorPosition
			? inserts.filter((insert) => insert.property === 'x' || insert.property === 'y')
			: [];
		const scalarInserts = inserts.filter((insert) => !vectorInserts.includes(insert));
		let patch: Partial<TimelineItem> = {};
		let position: VectorKeyframe[] | undefined;
		if (vectorInserts.length > 0) {
			const firstFrame = vectorInserts[0]?.frame;
			const promoted = promotePositionKeyframes(item, firstFrame);
			if (!promoted) return [];
			remapPromotedSelection(itemId, promoted.identityRemap);
			position = promoted.position;
			const groups = new Map<string, KeyframeInsert[]>();
			for (const insert of vectorInserts) {
				const key = `${insert.vectorGroupId ?? 'legacy'}:${insert.frame}`;
				const group = groups.get(key) ?? [];
				group.push(insert);
				groups.set(key, group);
			}
			for (const group of groups.values()) {
				const first = group[0];
				if (!first) continue;
				const current = interpolatePosition(position, first.frame) ?? {
					x: item.transform?.x ?? 0,
					y: item.transform?.y ?? 0
				};
				position = upsertPositionKeyframe(position, first.frame, current);
				const index = position.findIndex((keyframe) => keyframe.frame === first.frame);
				const keyframe = position[index];
				if (!keyframe) return [];
				const value = { ...keyframe.value };
				for (const insert of group) setPositionComponent(value, insert.property, insert.value);
				const nextKeyframe: VectorKeyframe = {
					...keyframe,
					value,
					easing: first.easing ?? 'linear'
				};
				if (first.easingConfig)
					nextKeyframe.easingConfig = cloneEasingConfig(first.easingConfig) ?? undefined;
				else delete nextKeyframe.easingConfig;
				if (first.spatial) {
					nextKeyframe.spatial = {
						...first.spatial,
						inTangent: { ...first.spatial.inTangent },
						outTangent: { ...first.spatial.outTangent }
					};
				} else delete nextKeyframe.spatial;
				position[index] = nextKeyframe;
				for (const insert of group) {
					refsByInsert.set(insert, {
						property: insert.property,
						frame: insert.frame,
						id: insert.property === 'x' ? keyframe.id : `${keyframe.id}:y`,
						vectorId: keyframe.id,
						index
					});
				}
			}
			patch = { ...patch, ...vectorKeyframesPatch(item, position) };
		}

		let keyframes: ItemKeyframes = { ...(patch.keyframes ?? item.keyframes) };
		for (const [property, propertyInserts] of Map.groupBy(
			scalarInserts,
			(insert) => insert.property
		)) {
			const track = withCompleteMetadata(
				keyframes[property] ?? { frames: [], values: [], ids: [], easings: [], easingConfigs: [] },
				property
			);
			for (const insert of propertyInserts) {
				let index = track.frames.indexOf(insert.frame);
				if (index < 0) {
					index = track.frames.length;
					track.frames.push(insert.frame);
					track.values.push(insert.value);
					track.ids.push(crypto.randomUUID());
					track.easings.push(insert.easing ?? 'linear');
					track.easingConfigs.push(cloneEasingConfig(insert.easingConfig ?? null));
				} else {
					track.values[index] = insert.value;
					track.easings[index] = insert.easing ?? 'linear';
					track.easingConfigs[index] = cloneEasingConfig(insert.easingConfig ?? null);
				}
				refsByInsert.set(insert, {
					property,
					frame: insert.frame,
					id: track.ids[index],
					index
				});
			}

			const indexes = track.frames
				.map((_, index) => index)
				.toSorted((left, right) => track.frames[left] - track.frames[right]);
			keyframes = {
				...keyframes,
				[property]: {
					frames: indexes.map((index) => track.frames[index]),
					values: indexes.map((index) => track.values[index]),
					ids: indexes.map((index) => track.ids[index]),
					easings: indexes.map((index) => track.easings[index]),
					easingConfigs: indexes.map((index) => track.easingConfigs[index])
				}
			};
		}

		if (scalarInserts.length > 0) patch.keyframes = keyframes;
		timelineStore._updateItems([{ id: itemId, patch }]);
		return inserts.flatMap((insert) => {
			const ref = refsByInsert.get(insert);
			if (!ref) return [];
			const sortedIndex = ref.vectorId
				? (position?.findIndex((keyframe) => keyframe.id === ref.vectorId) ?? -1)
				: (keyframes[ref.property]?.ids?.indexOf(ref.id ?? '') ?? -1);
			return [{ ...ref, index: sortedIndex >= 0 ? sortedIndex : ref.index }];
		});
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
		const positionSource = activePositionKeyframes(item);
		const vectorIds = new Set(
			positionSource
				? refs.flatMap((ref) => {
						const id = vectorIdForRef(positionSource, ref);
						return id ? [id] : [];
					})
				: []
		);
		let patch: Partial<TimelineItem> = {};
		if (positionSource && vectorIds.size > 0) {
			const position = positionSource.filter((keyframe) => !vectorIds.has(keyframe.id));
			patch = { ...patch, ...vectorKeyframesPatch(item, position) };
		}
		const scalarRefs = refs.filter(
			(ref) => !positionSource || vectorIdForRef(positionSource, ref) === null
		);
		let keyframes = patch.keyframes ?? item.keyframes;
		for (const [property, propertyRefs] of Map.groupBy(scalarRefs, (ref) => ref.property)) {
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
		if (keyframes !== (patch.keyframes ?? item.keyframes)) patch.keyframes = keyframes;
		if (Object.keys(patch).length === 0) return false;
		timelineStore._updateItems([{ id: itemId, patch }]);
		return true;
	});
}

function vectorIdForRef(position: readonly VectorKeyframe[], ref: KeyframeRef): string | null {
	if (ref.property !== 'x' && ref.property !== 'y') return null;
	const candidate = ref.vectorId ?? (ref.id?.endsWith(':y') ? ref.id.slice(0, -2) : ref.id);
	if (candidate && position.some((keyframe) => keyframe.id === candidate)) return candidate;
	const byIndex = ref.index === undefined ? undefined : position[ref.index];
	if (byIndex?.frame === ref.frame) return byIndex.id;
	return position.find((keyframe) => keyframe.frame === ref.frame)?.id ?? null;
}

function remapPromotedSelection(itemId: string, identityRemap: ReadonlyMap<string, string>): void {
	if (identityRemap.size === 0) return;
	const selected = keyframeSelectionStore.forItem(itemId);
	if (selected.size === 0) return;
	keyframeSelectionStore.replace(
		itemId,
		[...selected].map((id) => identityRemap.get(id) ?? id)
	);
}

function updatePositionKeyframes(
	source: readonly VectorKeyframe[],
	edits: readonly KeyframeEdit[]
): VectorKeyframe[] | null {
	const grouped = new Map<string, KeyframeEdit[]>();
	for (const edit of edits) {
		const id = vectorIdForRef(source, edit.ref);
		if (!id) return null;
		const group = grouped.get(id) ?? [];
		group.push(edit);
		grouped.set(id, group);
	}
	const targetFrames = new Set<number>();
	const edited = new Map<string, VectorKeyframe>();
	for (const [id, group] of grouped) {
		const original = source.find((keyframe) => keyframe.id === id);
		if (!original) return null;
		const frames = new Set(group.map((edit) => edit.frame));
		if (frames.size !== 1) return null;
		const frame = group[0]?.frame;
		if (frame === undefined || targetFrames.has(frame)) return null;
		targetFrames.add(frame);
		const value = { ...original.value };
		for (const edit of group) setPositionComponent(value, edit.ref.property, edit.value);
		edited.set(id, { ...cloneVectorKeyframe(original), frame, value });
	}
	const byFrame = new Map<number, { keyframe: VectorKeyframe; edited: boolean }>();
	for (const original of source) {
		const next = edited.get(original.id) ?? cloneVectorKeyframe(original);
		const isEdited = edited.has(original.id);
		const existing = byFrame.get(next.frame);
		if (!existing || isEdited) byFrame.set(next.frame, { keyframe: next, edited: isEdited });
	}
	return [...byFrame.values()]
		.map((entry) => entry.keyframe)
		.toSorted((left, right) => left.frame - right.frame);
}

function duplicatePositionKeyframes(
	source: readonly VectorKeyframe[],
	edits: readonly KeyframeEdit[]
): VectorKeyframe[] | null {
	const groups = new Map<string, KeyframeEdit[]>();
	for (const edit of edits) {
		const id = vectorIdForRef(source, edit.ref);
		if (!id) return null;
		const key = `${id}:${edit.frame}`;
		const group = groups.get(key) ?? [];
		group.push(edit);
		groups.set(key, group);
	}
	let position = source.map(cloneVectorKeyframe);
	for (const group of groups.values()) {
		const first = group[0];
		if (!first) continue;
		const sourceId = vectorIdForRef(source, first.ref);
		const original = source.find((keyframe) => keyframe.id === sourceId);
		if (!original) return null;
		const targetIndex = position.findIndex((keyframe) => keyframe.frame === first.frame);
		const existing = targetIndex >= 0 ? position[targetIndex] : undefined;
		const value = existing?.value ??
			interpolatePosition(position, first.frame) ?? { ...original.value };
		const duplicate: VectorKeyframe = {
			...cloneVectorKeyframe(original),
			id: existing?.id ?? crypto.randomUUID(),
			frame: first.frame,
			value: { ...value }
		};
		for (const edit of group) setPositionComponent(duplicate.value, edit.ref.property, edit.value);
		if (targetIndex >= 0) position[targetIndex] = duplicate;
		else position.push(duplicate);
		position = position.toSorted((left, right) => left.frame - right.frame);
	}
	return position;
}

function setPositionComponent(
	value: { x: number; y: number },
	property: KeyframeProperty,
	next: number
): void {
	if (property === 'x') value.x = next;
	else if (property === 'y') value.y = next;
}

function upsertTrack(
	keyframes: ItemKeyframes,
	property: KeyframeProperty,
	frame: number,
	value: number
): ItemKeyframes {
	const source = keyframes[property];
	const complete = withCompleteMetadata(source ?? { frames: [], values: [] }, property);
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

function withCompleteMetadata(
	track: KeyframeTrack,
	property: KeyframeProperty
): Required<KeyframeTrack> {
	return {
		frames: [...track.frames],
		values: [...track.values],
		ids: track.frames.map(
			(frame, index) => track.ids?.[index] ?? legacyKeyframeId(property, frame, index)
		),
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
