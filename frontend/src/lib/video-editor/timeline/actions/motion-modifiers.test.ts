import { beforeEach, describe, expect, it } from 'vitest';
import type { MotionModifier, TimelineItem } from '$lib/video-editor/project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import {
	applyMotionModifierToItems,
	beginMotionModifierEdit,
	commitMotionModifierEdit,
	removeMotionModifierFromItems,
	updateMotionModifiersLive
} from './motion-modifiers';

function item(id: string, motionModifiers?: MotionModifier[]): TimelineItem {
	return {
		id,
		trackId: 'visual',
		from: 0,
		durationInFrames: 90,
		label: id,
		type: 'video',
		motionModifiers
	};
}

function modifier(type: MotionModifier['type'], amplitude = 1): MotionModifier {
	return {
		version: 2,
		id: `${type}-${amplitude}`,
		type,
		enabled: true,
		amplitude,
		frequency: 1,
		phaseFrames: 0,
		seed: 1
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore._setItems([item('one'), item('two')]);
});

describe('motion modifier actions', () => {
	it('applies or replaces one type across a selection in one undo step', () => {
		expect(
			applyMotionModifierToItems([
				{ itemId: 'one', modifier: modifier('float-drift') },
				{ itemId: 'two', modifier: modifier('float-drift') }
			])
		).toBe(2);
		expect(commandHistory.undoStack).toHaveLength(1);

		applyMotionModifierToItems([{ itemId: 'one', modifier: modifier('float-drift', 0.4) }]);
		expect(timelineStore.itemById.get('one')?.motionModifiers).toMatchObject([
			{ type: 'float-drift', amplitude: 0.4 }
		]);
		expect(timelineStore.itemById.get('one')?.motionModifiers).toHaveLength(1);
	});

	it('removes one behavior without touching the others', () => {
		timelineStore._setItems([
			item('one', [modifier('float-drift'), modifier('spin')]),
			item('two', [modifier('float-drift')])
		]);
		expect(removeMotionModifierFromItems(['one', 'two'], 'float-drift')).toBe(2);
		expect(timelineStore.itemById.get('one')?.motionModifiers).toMatchObject([{ type: 'spin' }]);
		expect(timelineStore.itemById.get('two')?.motionModifiers).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('coalesces a stream of live slider changes into one undo step', () => {
		applyMotionModifierToItems([{ itemId: 'one', modifier: modifier('sway') }]);
		commandHistory.clearHistory();
		const before = beginMotionModifierEdit();
		updateMotionModifiersLive([{ itemId: 'one', modifier: modifier('sway', 0.8) }]);
		updateMotionModifiersLive([{ itemId: 'one', modifier: modifier('sway', 0.35) }]);
		commitMotionModifierEdit(before, 'sway', ['one']);
		expect(timelineStore.itemById.get('one')?.motionModifiers?.[0]?.amplitude).toBe(0.35);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('one')?.motionModifiers?.[0]?.amplitude).toBe(1);
	});
});
