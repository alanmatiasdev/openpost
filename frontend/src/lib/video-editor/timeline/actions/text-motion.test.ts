import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../project/types';
import { createTextMotionEffect } from '../text-motion-presets';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import {
	applyTextMotionToItems,
	beginTextMotionEdit,
	commitTextMotionEdit,
	removeTextMotionFromItems,
	updateTextMotionLive
} from './text-motion';

function item(id: string, type: TimelineItem['type'] = 'text'): TimelineItem {
	return { id, trackId: 'visual', from: 0, durationInFrames: 60, label: id, type, text: id };
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore._setItems([item('one'), item('two'), item('video', 'video')]);
});

describe('text motion actions', () => {
	it('applies a slot across text clips in one undo step and ignores non-text clips', () => {
		expect(
			applyTextMotionToItems([
				{ itemId: 'one', slot: 'in', effect: createTextMotionEffect('rise') },
				{ itemId: 'two', slot: 'in', effect: createTextMotionEffect('rise') },
				{ itemId: 'video', slot: 'in', effect: createTextMotionEffect('rise') }
			])
		).toBe(2);
		expect(timelineStore.itemById.get('one')?.textMotion?.in?.presetId).toBe('rise');
		expect(timelineStore.itemById.get('video')?.textMotion).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('coalesces live changes and restores them with undo', () => {
		applyTextMotionToItems([
			{ itemId: 'one', slot: 'loop', effect: createTextMotionEffect('wave') }
		]);
		commandHistory.clearHistory();
		const before = beginTextMotionEdit();
		updateTextMotionLive(['one'], 'loop', { intensity: 0.8 });
		updateTextMotionLive(['one'], 'loop', { intensity: 0.35, order: 'center' });
		commitTextMotionEdit(before, 'loop', ['one']);
		expect(timelineStore.itemById.get('one')?.textMotion?.loop).toMatchObject({
			intensity: 0.35,
			order: 'center'
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('one')?.textMotion?.loop).toMatchObject({
			intensity: 1,
			order: 'forward'
		});
	});

	it('removes only the requested slot', () => {
		applyTextMotionToItems([
			{ itemId: 'one', slot: 'in', effect: createTextMotionEffect('pop') },
			{ itemId: 'one', slot: 'loop', effect: createTextMotionEffect('pulse') }
		]);
		expect(removeTextMotionFromItems(['one'], 'in')).toBe(1);
		expect(timelineStore.itemById.get('one')?.textMotion).toMatchObject({
			loop: { presetId: 'pulse' }
		});
	});
});
