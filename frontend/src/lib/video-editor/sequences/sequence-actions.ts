/** Undoable sequence and compound-clip editing actions. */

import { createDefaultTracks } from '../project/defaults';
import { cloneSubCompositionDocument } from '../project/project-clone';
import type {
	SubComposition,
	TimelineItem,
	TimelineTrack,
	TimelineTransition
} from '../project/types';
import { commandHistory, execute } from '../timeline/commands/command-store.svelte';
import { clonePropertyRuntime } from '../timeline/actions/property-runtime';
import {
	detachedTransformParentBinding,
	detachTransformChildrenForRemoval
} from '../timeline/actions/transform-parenting';
import { transitionsStore } from '../timeline/actions/transitions.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { expandSelectionWithLinkedItems } from '../timeline/utils/linked-items';
import { snapshotTimelineState } from '../timeline/utils/state-snapshot.svelte';
import { effectiveMediaTracks } from '../timeline/utils/track-groups';
import {
	mapSourceWindowOverlap,
	timelineToSourceFrames
} from '../timeline/utils/source-calculations';
import { wouldCreateCompositionCycle } from './composition-graph';
import { sequenceStore } from './sequence-store.svelte';

function hasVisual(items: TimelineItem[]): boolean {
	return items.some((item) => item.type !== 'audio');
}

function hasAudio(items: TimelineItem[]): boolean {
	return items.some((item) => item.type === 'audio' || item.type === 'video');
}

function wrapperSourceFields(composition: SubComposition) {
	return {
		sourceStart: 0,
		sourceEnd: composition.durationInFrames,
		sourceDuration: composition.durationInFrames,
		sourceFps: composition.fps,
		speed: 1
	};
}

function visualTrackFor(items: TimelineItem[], tracks: TimelineTrack[]): TimelineTrack | undefined {
	const selectedTrackIds = new Set(items.map((item) => item.trackId));
	return tracks
		.filter((track) => selectedTrackIds.has(track.id) && track.kind !== 'audio')
		.toSorted((left, right) => right.order - left.order)[0];
}

function audioTrackFor(items: TimelineItem[], tracks: TimelineTrack[]): TimelineTrack | undefined {
	const selectedTrackIds = new Set(items.map((item) => item.trackId));
	return (
		tracks
			.filter((track) => selectedTrackIds.has(track.id) && track.kind === 'audio')
			.toSorted((left, right) => right.order - left.order)[0] ??
		tracks.filter((track) => track.kind === 'audio').toSorted((a, b) => b.order - a.order)[0]
	);
}

export function createSequence(name = 'Sequence'): string {
	return execute('CREATE_SEQUENCE', () => {
		const id = crypto.randomUUID();
		sequenceStore.addComposition(
			{
				id,
				name,
				editorKind: 'sequence',
				items: [],
				tracks: createDefaultTracks(),
				transitions: [],
				fps: timelineStore.fps,
				width: sequenceStore.activeWidth,
				height: sequenceStore.activeHeight,
				durationInFrames: 0
			},
			true
		);
		return id;
	});
}

export function renameSequence(id: string, name: string): boolean {
	const trimmed = name.trim();
	if (!trimmed) return false;
	return execute('RENAME_SEQUENCE', () => {
		if (!sequenceStore.updateComposition(id, { name: trimmed })) return false;
		const rename = (item: TimelineItem): TimelineItem =>
			item.compositionId === id && item.label !== trimmed ? { ...item, label: trimmed } : item;
		timelineStore._setItems(timelineStore.items.map(rename));
		for (const composition of sequenceStore.compositions) {
			if (composition.id !== id) {
				sequenceStore.updateComposition(composition.id, {
					items: composition.items.map(rename)
				});
			}
		}
		return true;
	});
}

export function duplicateSequence(id: string, name?: string): string | null {
	return execute('DUPLICATE_SEQUENCE', () => {
		const source = sequenceStore.compositionById.get(id);
		if (!source) return null;
		const names = new Set(sequenceStore.compositions.map((composition) => composition.name));
		const baseName = name?.trim() || `${source.name} copy`;
		let copyName = baseName;
		for (let suffix = 2; names.has(copyName); suffix += 1) copyName = `${baseName} ${suffix}`;
		const duplicate = cloneSubCompositionDocument(source, { name: copyName });
		sequenceStore.addComposition(duplicate, sequenceStore.topLevelSequenceIds.includes(source.id));
		return duplicate.id;
	});
}

export interface SequenceDeletionImpact {
	rootReferenceCount: number;
	nestedReferenceCount: number;
	totalReferenceCount: number;
}

export function sequenceDeletionImpact(compositionId: string): SequenceDeletionImpact {
	const timeline = sequenceStore.projectTimeline();
	const rootReferenceCount = timeline.items.filter(
		(item) => item.compositionId === compositionId
	).length;
	const nestedReferenceCount = (timeline.compositions ?? [])
		.filter((composition) => composition.id !== compositionId)
		.reduce(
			(count, composition) =>
				count + composition.items.filter((item) => item.compositionId === compositionId).length,
			0
		);
	return {
		rootReferenceCount,
		nestedReferenceCount,
		totalReferenceCount: rootReferenceCount + nestedReferenceCount
	};
}

export function nestSequence(compositionId: string, from = timelineStore.currentFrame): string[] {
	return execute('NEST_SEQUENCE', () => {
		const composition = sequenceStore.compositionById.get(compositionId);
		if (!composition) throw new Error('Sequence not found.');
		if (
			wouldCreateCompositionCycle(
				sequenceStore.activeSequenceId,
				compositionId,
				sequenceStore.compositionById
			)
		)
			throw new Error('A sequence cannot contain itself.');
		const effectiveTracks = effectiveMediaTracks(timelineStore.tracks);
		const visualTrack = effectiveTracks
			.filter((track) => track.kind !== 'audio' && !track.locked)
			.toSorted((left, right) => left.order - right.order)[0];
		const audioTrack = effectiveTracks
			.filter((track) => track.kind === 'audio' && !track.locked)
			.toSorted((left, right) => right.order - left.order)[0];
		const linkedGroupId =
			hasVisual(composition.items) && hasAudio(composition.items) ? crypto.randomUUID() : undefined;
		const wrappers: TimelineItem[] = [];
		if (hasVisual(composition.items) && visualTrack) {
			wrappers.push({
				id: crypto.randomUUID(),
				type: 'composition',
				trackId: visualTrack.id,
				from,
				durationInFrames: Math.max(1, composition.durationInFrames),
				label: composition.name,
				compositionId,
				compositionWidth: composition.width,
				compositionHeight: composition.height,
				linkedGroupId,
				transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
				...wrapperSourceFields(composition)
			});
		}
		if (hasAudio(composition.items) && audioTrack) {
			wrappers.push({
				id: crypto.randomUUID(),
				type: 'audio',
				trackId: audioTrack.id,
				from,
				durationInFrames: Math.max(1, composition.durationInFrames),
				label: composition.name,
				compositionId,
				linkedGroupId,
				...wrapperSourceFields(composition)
			});
		}
		if (wrappers.length === 0) throw new Error('No compatible unlocked track is available.');
		timelineStore._setItems([...timelineStore.items, ...wrappers]);
		return wrappers.map((wrapper) => wrapper.id);
	});
}

export function createCompoundClip(
	itemIds: string[],
	name = 'Compound Clip',
	editorKind: SubComposition['editorKind'] = 'sequence'
): string | null {
	return execute('CREATE_COMPOUND_CLIP', () => {
		const expandedIds = new Set(expandSelectionWithLinkedItems(timelineStore.items, itemIds));
		const selected = timelineStore.items.filter((item) => expandedIds.has(item.id));
		if (selected.length === 0) return null;
		const minFrom = Math.min(...selected.map((item) => item.from));
		const maxEnd = Math.max(...selected.map((item) => item.from + item.durationInFrames));
		const selectedTrackIds = new Set(selected.map((item) => item.trackId));
		const selectedItemIds = new Set(selected.map((item) => item.id));
		const compositionId = crypto.randomUUID();
		const composition: SubComposition = {
			id: compositionId,
			name,
			editorKind,
			items: selected.map((item) => {
				const snapshot = snapshotTimelineState(item);
				const propertyLinks = snapshot.propertyLinks?.filter((link) =>
					selectedItemIds.has(link.sourceItemId)
				);
				const externalParent =
					snapshot.transformParent?.parentItemId &&
					!selectedItemIds.has(snapshot.transformParent.parentItemId);
				return {
					...snapshot,
					from: item.from - minFrom,
					...(snapshot.propertyLinks && {
						propertyLinks: propertyLinks?.length ? propertyLinks : undefined
					}),
					...(externalParent && {
						transformParent: detachedTransformParentBinding(item)
					})
				};
			}),
			tracks: timelineStore.tracks
				.filter((track) => selectedTrackIds.has(track.id))
				.map((track) => snapshotTimelineState(track)),
			transitions: transitionsStore.list.filter(
				(transition) =>
					expandedIds.has(transition.fromItemId) && expandedIds.has(transition.toItemId)
			),
			fps: timelineStore.fps,
			width: sequenceStore.activeWidth,
			height: sequenceStore.activeHeight,
			durationInFrames: maxEnd - minFrom
		};
		sequenceStore.addComposition(composition);
		detachTransformChildrenForRemoval([...expandedIds]);
		timelineStore._removeItems([...expandedIds]);
		transitionsStore.setAll(
			transitionsStore.list.filter(
				(transition) =>
					!expandedIds.has(transition.fromItemId) && !expandedIds.has(transition.toItemId)
			)
		);
		const visualTrack = visualTrackFor(selected, timelineStore.tracks);
		const audioTrack = audioTrackFor(selected, timelineStore.tracks);
		const linkedGroupId =
			hasVisual(selected) && hasAudio(selected) ? crypto.randomUUID() : undefined;
		const wrappers: TimelineItem[] = [];
		if (hasVisual(selected) && visualTrack) {
			wrappers.push({
				id: crypto.randomUUID(),
				type: 'composition',
				trackId: visualTrack.id,
				from: minFrom,
				durationInFrames: composition.durationInFrames,
				label: name,
				compositionId,
				compositionWidth: composition.width,
				compositionHeight: composition.height,
				linkedGroupId,
				transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
				...wrapperSourceFields(composition)
			});
		}
		if (hasAudio(selected) && audioTrack) {
			wrappers.push({
				id: crypto.randomUUID(),
				type: 'audio',
				trackId: audioTrack.id,
				from: minFrom,
				durationInFrames: composition.durationInFrames,
				label: name,
				compositionId,
				linkedGroupId,
				...wrapperSourceFields(composition)
			});
		}
		timelineStore._setItems([...timelineStore.items, ...wrappers]);
		return compositionId;
	});
}

function remapTransition(
	transition: TimelineTransition,
	idMap: Map<string, string>
): TimelineTransition | null {
	const fromItemId = idMap.get(transition.fromItemId);
	const toItemId = idMap.get(transition.toItemId);
	return fromItemId && toItemId
		? { ...transition, id: crypto.randomUUID(), fromItemId, toItemId }
		: null;
}

function mapItemThroughWrapper(
	item: TimelineItem,
	wrapper: TimelineItem,
	timelineFps: number,
	compositionFps: number
): TimelineItem | null {
	const mapping = mapSourceWindowOverlap({
		itemStart: item.from,
		itemDuration: item.durationInFrames,
		wrapperDuration: wrapper.durationInFrames,
		wrapperSpeed: wrapper.speed,
		wrapperSourceFps: wrapper.sourceFps,
		wrapperSourceStart: wrapper.sourceStart ?? 0,
		wrapperSourceEnd: wrapper.sourceEnd,
		timelineFps,
		fallbackSourceFps: compositionFps
	});
	if (!mapping) return null;

	const mapped: TimelineItem = {
		...snapshotTimelineState(item),
		from: wrapper.from + mapping.mappedFrom,
		durationInFrames: mapping.mappedDuration,
		speed: (item.speed ?? 1) * mapping.wrapperSpeed
	};
	if (item.type === 'video' || item.type === 'audio' || item.type === 'composition') {
		const childSourceFps =
			item.sourceFps ??
			(item.compositionId
				? (sequenceStore.compositionById.get(item.compositionId)?.fps ?? compositionFps)
				: compositionFps);
		const childSpeed = item.speed ?? 1;
		const nextSourceStart =
			(item.sourceStart ?? 0) +
			timelineToSourceFrames(
				mapping.clippedStartFrames,
				childSpeed,
				compositionFps,
				childSourceFps
			);
		mapped.sourceStart = nextSourceStart;
		if (item.sourceEnd !== undefined) {
			mapped.sourceEnd = Math.max(
				nextSourceStart + 1,
				item.sourceEnd -
					timelineToSourceFrames(
						mapping.clippedEndFrames,
						childSpeed,
						compositionFps,
						childSourceFps
					)
			);
		}
	}
	return mapped;
}

function itemTrackKind(item: TimelineItem): 'video' | 'audio' {
	return item.type === 'audio' ? 'audio' : 'video';
}

interface DissolveTrackMap {
	trackMap: Map<string, string>;
	tracks: TimelineTrack[];
}

function buildDissolveTrackMap(
	composition: SubComposition,
	wrapperItems: TimelineItem[],
	existingTracks: TimelineTrack[]
): DissolveTrackMap {
	const trackMap = new Map<string, string>();
	const nextTracks = [...existingTracks];
	const existingIds = new Set(existingTracks.map((track) => track.id));
	const visualAnchor = wrapperItems.find((item) => item.type === 'composition');
	const audioAnchor = wrapperItems.find((item) => item.type === 'audio');
	const usedAnchors = new Set<string>();

	for (const sourceTrack of composition.tracks.toSorted(
		(left, right) => left.order - right.order
	)) {
		const sourceItems = composition.items.filter((item) => item.trackId === sourceTrack.id);
		const kind =
			sourceTrack.kind === 'audio' ||
			(sourceItems.length > 0 && sourceItems.every((item) => itemTrackKind(item) === 'audio'))
				? 'audio'
				: 'video';
		const existingTrack = existingIds.has(sourceTrack.id)
			? existingTracks.find((track) => track.id === sourceTrack.id)
			: undefined;
		if (existingTrack?.kind === kind) {
			trackMap.set(sourceTrack.id, sourceTrack.id);
			continue;
		}
		const anchor = kind === 'audio' ? audioAnchor : visualAnchor;
		if (anchor && !usedAnchors.has(anchor.trackId)) {
			trackMap.set(sourceTrack.id, anchor.trackId);
			usedAnchors.add(anchor.trackId);
			continue;
		}
		const id = crypto.randomUUID();
		const anchorTrack = anchor
			? nextTracks.find((track) => track.id === anchor.trackId)
			: nextTracks.find((track) => track.kind === kind);
		nextTracks.push({
			...snapshotTimelineState(sourceTrack),
			id,
			kind,
			order: (anchorTrack?.order ?? sourceTrack.order) + (kind === 'audio' ? 0.01 : -0.01)
		});
		trackMap.set(sourceTrack.id, id);
	}
	return { trackMap, tracks: nextTracks };
}

export function dissolveCompoundClip(wrapperId: string): string[] {
	return execute('DISSOLVE_COMPOUND_CLIP', () => {
		const wrapper = timelineStore.itemById.get(wrapperId);
		if (!wrapper?.compositionId) return [];
		const composition = sequenceStore.compositionById.get(wrapper.compositionId);
		if (!composition) return [];
		const wrapperItems = timelineStore.items.filter(
			(item) =>
				item.compositionId === wrapper.compositionId &&
				(item.id === wrapper.id ||
					(Boolean(wrapper.linkedGroupId) && item.linkedGroupId === wrapper.linkedGroupId))
		);
		const wrapperIds = new Set(wrapperItems.map((item) => item.id));
		const windowAnchor =
			wrapperItems.find((item) => item.type === 'composition') ?? wrapperItems[0];
		if (!windowAnchor) return [];
		const { trackMap, tracks } = buildDissolveTrackMap(
			composition,
			wrapperItems,
			timelineStore.tracks
		);
		const idMap = new Map<string, string>();
		const mappedItems = composition.items.flatMap((item) => {
			const mapped = mapItemThroughWrapper(item, windowAnchor, timelineStore.fps, composition.fps);
			if (!mapped) return [];
			const id = crypto.randomUUID();
			idMap.set(item.id, id);
			return [
				{
					...mapped,
					id,
					originId: item.originId ?? item.id,
					trackId: trackMap.get(item.trackId) ?? windowAnchor.trackId
				}
			];
		});
		const restored = mappedItems.map((item) => ({
			...item,
			...clonePropertyRuntime(item, idMap)
		}));
		timelineStore._setTracks(tracks);
		timelineStore._setItems([
			...timelineStore.items.filter((item) => !wrapperIds.has(item.id)),
			...restored
		]);
		const restoredTransitions = composition.transitions
			.map((transition) => remapTransition(transition, idMap))
			.filter((transition): transition is TimelineTransition => transition !== null);
		transitionsStore.setAll([
			...transitionsStore.list.filter(
				(transition) =>
					!wrapperIds.has(transition.fromItemId) && !wrapperIds.has(transition.toItemId)
			),
			...restoredTransitions
		]);
		return restored.map((item) => item.id);
	});
}

export function deleteSequence(compositionId: string): boolean {
	if (sequenceStore.activeSequenceId === compositionId && !switchSequence(null)) return false;
	return execute('DELETE_SEQUENCE', () => {
		const removed = sequenceStore.deleteCompositionAndReferences(compositionId);
		if (removed) commandHistory.removeContext(compositionId);
		return removed;
	});
}

export function switchSequence(sequenceId: string | null): boolean {
	if (!sequenceStore.switchTo(sequenceId)) return false;
	commandHistory.setActiveContext(sequenceId);
	return true;
}
