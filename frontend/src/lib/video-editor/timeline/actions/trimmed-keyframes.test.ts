import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { transitionsStore } from './transitions-store.svelte';
import { trimAnimationToItemBounds } from './trimmed-keyframes';

function item(id: string, overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id,
		trackId: 'visual',
		from: 0,
		durationInFrames: 10,
		label: id,
		type: 'video',
		...overrides
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	transitionsStore.clear();
});

describe('trimAnimationToItemBounds', () => {
	it('cleans several clips with one history entry', () => {
		timelineStore._setItems([
			item('one', {
				keyframes: { opacity: { frames: [0, 20], values: [0, 1] } }
			}),
			item('two', {
				keyframes: { rotation: { frames: [0, 15], values: [0, 30] } }
			})
		]);
		expect(trimAnimationToItemBounds(['one', 'two'])).toMatchObject({
			ok: true,
			cleanedItems: 2,
			removedCount: 2,
			insertedBoundaryCount: 2
		});
		expect(timelineStore.itemById.get('one')?.keyframes?.opacity?.frames).toEqual([0, 9]);
		expect(timelineStore.itemById.get('two')?.keyframes?.rotation?.frames).toEqual([0, 9]);
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('does not add history when every key is already visible', () => {
		timelineStore._setItems([
			item('one', { keyframes: { opacity: { frames: [0, 9], values: [0, 1] } } })
		]);
		expect(trimAnimationToItemBounds(['one'])).toEqual({ ok: false, reason: 'no-change' });
		expect(commandHistory.undoStack).toHaveLength(0);
	});

	it('aborts all cleanup when a needed boundary belongs to a transition', () => {
		timelineStore._setItems([
			item('one', { keyframes: { opacity: { frames: [0, 20], values: [0, 1] } } }),
			item('two', { from: 10 })
		]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 6,
				fromItemId: 'one',
				toItemId: 'two'
			}
		]);
		expect(trimAnimationToItemBounds(['one'])).toEqual({
			ok: false,
			reason: 'transition-blocked'
		});
		expect(timelineStore.itemById.get('one')?.keyframes?.opacity?.frames).toEqual([0, 20]);
		expect(commandHistory.undoStack).toHaveLength(0);
	});
});
