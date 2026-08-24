import { beforeEach, describe, expect, test } from 'vitest';
import { createEmptyTimeline } from '../../project/defaults';
import type { TimelineItem, TimelineTrack } from '../../project/types';
import { sequenceStore } from '../../sequences/sequence-store.svelte';
import { resolveAnimatedItemAt } from '../animated-properties';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { detachTransformParent, setTransformParent } from './transform-parenting';
import { removeItems } from './items';

const track: TimelineTrack = {
	id: 'visual',
	name: 'Visual',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

function item(id: string, x: number, type: TimelineItem['type'] = 'shape'): TimelineItem {
	return {
		id,
		trackId: track.id,
		from: 0,
		durationInFrames: 60,
		label: id,
		type,
		transform: { x, y: 0, width: 100, height: 100 }
	};
}

function resolvedX(itemId: string): number | undefined {
	const source = timelineStore.itemById.get(itemId);
	if (!source) return undefined;
	return resolveAnimatedItemAt(source, timelineStore.currentFrame, {
		fps: timelineStore.fps,
		frameWidth: sequenceStore.activeWidth,
		frameHeight: sequenceStore.activeHeight,
		items: timelineStore.items
	}).transform?.x;
}

beforeEach(() => {
	commandHistory.clearHistory();
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	sequenceStore.load(
		{ ...createEmptyTimeline(), tracks: [track], items: [item('parent', 0), item('child', 10)] },
		{ width: 1920, height: 1080, fps: 30 }
	);
});

describe('transform parenting actions', () => {
	test('attaches without a visual jump and follows the parent with one-step undo', () => {
		expect(setTransformParent('child', 'parent')).toEqual({ ok: true });
		expect(resolvedX('child')).toBeCloseTo(10);
		timelineStore._updateItems([
			{ id: 'parent', patch: { transform: { x: 50, y: 0, width: 100, height: 100 } } }
		]);
		expect(resolvedX('child')).toBeCloseTo(60);

		commandHistory.undo();
		expect(timelineStore.itemById.get('child')?.transformParent).toBeUndefined();
	});

	test('detaches in place and stops following later parent edits', () => {
		setTransformParent('child', 'parent');
		timelineStore._updateItems([
			{ id: 'parent', patch: { transform: { x: 50, y: 0, width: 100, height: 100 } } }
		]);
		expect(detachTransformParent('child')).toBe(true);
		expect(resolvedX('child')).toBeCloseTo(60);

		timelineStore._updateItems([
			{ id: 'parent', patch: { transform: { x: 100, y: 0, width: 100, height: 100 } } }
		]);
		expect(resolvedX('child')).toBeCloseTo(60);
	});

	test('rejects unsupported, self, duplicate, and cyclic relationships before mutation', () => {
		timelineStore._setItems([
			...timelineStore.items,
			item('audio', 0, 'audio'),
			item('adjustment', 0, 'adjustment')
		]);
		expect(setTransformParent('child', 'child')).toEqual({ ok: false, reason: 'self' });
		expect(setTransformParent('audio', 'parent')).toEqual({
			ok: false,
			reason: 'unsupported-child'
		});
		expect(setTransformParent('child', 'adjustment')).toEqual({
			ok: false,
			reason: 'unsupported-parent'
		});
		expect(setTransformParent('child', 'parent')).toEqual({ ok: true });
		expect(setTransformParent('child', 'parent')).toEqual({
			ok: false,
			reason: 'already-parented'
		});
		expect(setTransformParent('parent', 'child')).toEqual({ ok: false, reason: 'cycle' });
	});

	test('deleting a parent freezes surviving children and restores both with undo', () => {
		setTransformParent('child', 'parent');
		timelineStore._updateItems([
			{ id: 'parent', patch: { transform: { x: 50, y: 0, width: 100, height: 100 } } }
		]);
		expect(resolvedX('child')).toBeCloseTo(60);

		expect(removeItems(['parent'], false)).toEqual(['parent']);
		expect(timelineStore.itemById.get('child')?.transformParent?.parentItemId).toBeUndefined();
		expect(resolvedX('child')).toBeCloseTo(60);

		commandHistory.undo();
		expect(timelineStore.itemById.has('parent')).toBe(true);
		expect(timelineStore.itemById.get('child')?.transformParent?.parentItemId).toBe('parent');
	});
});
