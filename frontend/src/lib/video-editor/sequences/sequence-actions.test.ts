import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyTimeline } from '../project/defaults';
import type { SubComposition, TimelineItem, TimelineTrack } from '../project/types';
import { transitionsStore } from '../timeline/actions/transitions.svelte';
import { commandHistory, execute } from '../timeline/commands/command-store.svelte';
import { setCurrentFrame } from '../timeline/actions/items';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import {
	createCompoundClip,
	createSequence,
	deleteSequence,
	dissolveCompoundClip,
	nestSequence,
	switchSequence
} from './sequence-actions';
import { sequenceStore } from './sequence-store.svelte';

function track(id: string, kind: 'video' | 'audio', order: number): TimelineTrack {
	return {
		id,
		name: id,
		kind,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order
	};
}

function item(extra: Partial<TimelineItem>): TimelineItem {
	return {
		id: 'clip',
		trackId: 'video',
		from: 0,
		durationInFrames: 30,
		label: 'Clip',
		type: 'video',
		...extra
	};
}

function composition(id: string, items: TimelineItem[] = []): SubComposition {
	return {
		id,
		name: id,
		editorKind: 'sequence',
		items,
		tracks: [track(`${id}-video`, 'video', 0), track(`${id}-audio`, 'audio', 1)],
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: items.reduce(
			(max, candidate) => Math.max(max, candidate.from + candidate.durationInFrames),
			0
		)
	};
}

beforeEach(() => {
	commandHistory.clearHistory();
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	transitionsStore.clear();
	sequenceStore.load(
		{
			...createEmptyTimeline(),
			tracks: [track('video', 'video', 0), track('audio', 'audio', 1)]
		},
		{ width: 1920, height: 1080, fps: 30 }
	);
});

describe('sequence navigation', () => {
	it('creates a promoted sequence and restores each tab playhead', () => {
		const id = createSequence('Alt cut');
		expect(sequenceStore.topLevelSequenceIds).toEqual([id]);
		expect(sequenceStore.compositionById.get(id)?.name).toBe('Alt cut');

		setCurrentFrame(42);
		expect(switchSequence(id)).toBe(true);
		expect(timelineStore.currentFrame).toBe(0);
		setCurrentFrame(11);
		expect(switchSequence(null)).toBe(true);
		expect(timelineStore.currentFrame).toBe(42);
		expect(switchSequence(id)).toBe(true);
		expect(timelineStore.currentFrame).toBe(11);
	});

	it('flushes edited sequence contents into the project document', () => {
		const id = createSequence('Scene');
		switchSequence(id);
		timelineStore._setItems([item({ id: 'inside', trackId: 'track-video-main' })]);
		const saved = sequenceStore.projectTimeline();
		expect(saved.items).toEqual([]);
		expect(saved.compositions?.find((entry) => entry.id === id)?.items[0]?.id).toBe('inside');
	});
});

describe('compound clips', () => {
	it('moves linked visual and audio items into one reusable composition', () => {
		const visual = item({ id: 'visual', linkedGroupId: 'pair', mediaId: 'media' });
		const audio = item({
			id: 'audio-item',
			type: 'audio',
			trackId: 'audio',
			linkedGroupId: 'pair',
			mediaId: 'media'
		});
		timelineStore._setItems([visual, audio]);
		transitionsStore.setAll([]);
		const compositionId = createCompoundClip(['visual'], 'Interview');
		expect(compositionId).not.toBeNull();
		const stored = sequenceStore.compositionById.get(compositionId!);
		expect(stored?.items.map((entry) => entry.id)).toEqual(['visual', 'audio-item']);
		expect(timelineStore.items).toHaveLength(2);
		expect(timelineStore.items.every((entry) => entry.compositionId === compositionId)).toBe(true);
		expect(new Set(timelineStore.items.map((entry) => entry.linkedGroupId)).size).toBe(1);

		commandHistory.undo();
		expect(sequenceStore.compositionById.has(compositionId!)).toBe(false);
		expect(timelineStore.items.map((entry) => entry.id)).toEqual(['visual', 'audio-item']);
	});

	it('dissolves a wrapper with fresh ids and restores internal transitions', () => {
		const left = item({ id: 'left', durationInFrames: 15 });
		const right = item({ id: 'right', from: 15, durationInFrames: 15 });
		timelineStore._setItems([left, right]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 4,
				fromItemId: 'left',
				toItemId: 'right'
			}
		]);
		const compositionId = createCompoundClip(['left', 'right']);
		const wrapper = timelineStore.items.find((entry) => entry.type === 'composition')!;
		const restoredIds = dissolveCompoundClip(wrapper.id);
		expect(restoredIds).toHaveLength(2);
		expect(restoredIds).not.toContain('left');
		expect(transitionsStore.list).toHaveLength(1);
		expect(transitionsStore.list[0]?.fromItemId).toBe(restoredIds[0]);
		expect(sequenceStore.compositionById.has(compositionId!)).toBe(true);
	});

	it('maps a trimmed retimed wrapper window back to child source frames', () => {
		const source = item({
			id: 'source',
			from: 10,
			durationInFrames: 30,
			sourceStart: 100,
			sourceEnd: 160,
			sourceFps: 60,
			speed: 2
		});
		timelineStore._setItems([source]);
		const compositionId = createCompoundClip(['source']);
		const wrapper = timelineStore.items.find((entry) => entry.type === 'composition')!;
		timelineStore._setItems([
			{
				...wrapper,
				from: 90,
				durationInFrames: 10,
				sourceStart: 5,
				sourceEnd: 25,
				sourceFps: 30,
				speed: 2
			}
		]);

		const [restoredId] = dissolveCompoundClip(wrapper.id);
		const restored = timelineStore.itemById.get(restoredId!);
		expect(restored).toMatchObject({
			from: 90,
			durationInFrames: 10,
			sourceStart: 120,
			sourceEnd: 140,
			speed: 4
		});
		expect(sequenceStore.compositionById.has(compositionId!)).toBe(true);
	});

	it('uses a nested child sequence fps when dissolving a trimmed parent', () => {
		sequenceStore.addComposition({
			...composition('child'),
			fps: 60,
			durationInFrames: 120
		});
		sequenceStore.addComposition(
			composition('parent', [
				item({
					id: 'child-wrapper',
					type: 'composition',
					trackId: 'parent-video',
					compositionId: 'child',
					sourceStart: 20,
					sourceEnd: 100,
					sourceFps: undefined,
					durationInFrames: 30
				})
			])
		);
		timelineStore._setItems([
			item({
				id: 'parent-wrapper',
				type: 'composition',
				compositionId: 'parent',
				sourceStart: 5,
				sourceEnd: 25,
				sourceFps: 30,
				speed: 2,
				durationInFrames: 10
			})
		]);

		const [restoredId] = dissolveCompoundClip('parent-wrapper');
		expect(timelineStore.itemById.get(restoredId!)?.sourceStart).toBe(30);
	});

	it('does not map restored audio onto an id-colliding video track', () => {
		sequenceStore.addComposition({
			...composition('audio-composition', [
				item({
					id: 'inside-audio',
					type: 'audio',
					trackId: 'video',
					mediaId: 'voice'
				})
			]),
			tracks: [track('video', 'audio', 0)],
			durationInFrames: 30
		});
		timelineStore._setItems([
			item({
				id: 'audio-wrapper',
				type: 'audio',
				trackId: 'audio',
				compositionId: 'audio-composition'
			})
		]);

		const [restoredId] = dissolveCompoundClip('audio-wrapper');
		const restored = timelineStore.itemById.get(restoredId!);
		expect(restored?.trackId).not.toBe('video');
		expect(timelineStore.tracks.find((entry) => entry.id === restored?.trackId)?.kind).toBe(
			'audio'
		);
	});

	it('blocks direct and indirect nesting cycles', () => {
		const a = composition('a');
		const b = composition('b', [
			item({
				id: 'a-in-b',
				type: 'composition',
				trackId: 'b-video',
				compositionId: 'a'
			})
		]);
		sequenceStore.addComposition(a, true);
		sequenceStore.addComposition(b, true);
		switchSequence('a');
		expect(() => nestSequence('a')).toThrow('cannot contain itself');
		expect(() => nestSequence('b')).toThrow('cannot contain itself');
	});

	it('deletes references from Main and every nested sequence', () => {
		const target = composition('target');
		const host = composition('host', [
			item({
				id: 'nested-target',
				type: 'composition',
				trackId: 'host-video',
				compositionId: 'target'
			})
		]);
		sequenceStore.addComposition(target, true);
		sequenceStore.addComposition(host, true);
		timelineStore._setItems([
			item({ id: 'root-target', type: 'composition', compositionId: 'target' })
		]);
		transitionsStore.setAll([
			{
				id: 'orphan-after-delete',
				type: 'crossfade',
				durationInFrames: 3,
				fromItemId: 'root-target',
				toItemId: 'root-target'
			}
		]);

		expect(deleteSequence('target')).toBe(true);
		expect(sequenceStore.compositionById.has('target')).toBe(false);
		expect(sequenceStore.compositionById.get('host')?.items).toEqual([]);
		expect(timelineStore.items).toEqual([]);
		expect(transitionsStore.list).toEqual([]);

		commandHistory.undo();
		expect(sequenceStore.compositionById.has('target')).toBe(true);
		expect(timelineStore.items[0]?.compositionId).toBe('target');
	});

	it('keeps undo history isolated between Main and a sequence tab', () => {
		const id = createSequence('Cutaway');
		timelineStore._setItems([item({ id: 'root-base' })]);
		execute('ROOT_EDIT', () => {
			timelineStore._setItems([...timelineStore.items, item({ id: 'root-edit', from: 30 })]);
		});
		switchSequence(id);
		execute('SEQUENCE_EDIT', () => {
			timelineStore._setItems([item({ id: 'sequence-edit', trackId: 'track-video-main' })]);
		});

		commandHistory.undo();
		expect(timelineStore.items).toEqual([]);
		switchSequence(null);
		expect(commandHistory.getLastCommandType()).toBe('ROOT_EDIT');
		commandHistory.undo();
		expect(timelineStore.items.map((entry) => entry.id)).toEqual(['root-base']);
	});

	it('does not roll back newer Main edits when undoing an older sequence edit', () => {
		const id = createSequence('Cutaway');
		switchSequence(id);
		execute('SEQUENCE_EDIT', () => {
			timelineStore._setItems([item({ id: 'sequence-edit', trackId: 'track-video-main' })]);
		});
		switchSequence(null);
		execute('ROOT_EDIT', () => {
			timelineStore._setItems([item({ id: 'newer-root-edit' })]);
		});
		switchSequence(id);

		commandHistory.undo();
		expect(timelineStore.items).toEqual([]);
		switchSequence(null);
		expect(timelineStore.items.map((entry) => entry.id)).toEqual(['newer-root-edit']);
	});
});
