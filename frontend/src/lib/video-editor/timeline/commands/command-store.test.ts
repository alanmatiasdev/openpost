import { beforeEach, describe, expect, it } from 'vitest';
import { timelineStore } from '../stores/timeline-store.svelte';
import { commandHistory, execute } from '../commands/command-store.svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';

function videoItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: crypto.randomUUID(),
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 90,
		label: 'clip',
		type: 'video',
		mediaId: 'media-1',
		sourceStart: 0,
		sourceDuration: 900,
		sourceFps: 30,
		speed: 1,
		...overrides
	};
}

describe('command history', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	});

	it('execute records one undo entry only when state changed', () => {
		execute('ADD_ITEMS', () => {
			timelineStore._setItems([videoItem()]);
		});
		expect(commandHistory.undoStack.length).toBe(1);

		execute('NOOP', () => undefined);
		expect(commandHistory.undoStack.length).toBe(1);
	});

	it('undo restores previous items and redo re-applies them', () => {
		const item = videoItem({ durationInFrames: 30 });
		timelineStore._setItems([item]);

		execute('REMOVE_ITEMS', () => {
			timelineStore._removeItems([item.id]);
		});
		expect(timelineStore.items.length).toBe(0);
		expect(commandHistory.canUndo).toBe(true);

		commandHistory.undo();
		expect(timelineStore.items.length).toBe(1);
		expect(commandHistory.canRedo).toBe(true);

		commandHistory.redo();
		expect(timelineStore.items.length).toBe(0);
	});

	it('new action clears the redo stack', () => {
		const item = videoItem();
		timelineStore._setItems([item]);
		execute('REMOVE_ITEMS', () => timelineStore._removeItems([item.id]));
		commandHistory.undo();
		expect(commandHistory.canRedo).toBe(true);

		execute('ADD_ITEMS', () => timelineStore._setItems([videoItem()]));
		expect(commandHistory.canRedo).toBe(false);
	});

	it('respects maxUndoHistory cap', () => {
		for (let i = 0; i < 150; i++) {
			const frame = i;
			execute('TICK', () => {
				timelineStore._setCurrentFrame(frame);
				timelineStore._setSnapEnabled(frame % 2 === 0);
				timelineStore._addItem(videoItem({ id: crypto.randomUUID(), from: i * 1000 }));
			});
		}
		expect(commandHistory.undoStack.length).toBeLessThanOrEqual(100);
	});
});

describe('_splitItem source boundaries', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	});

	it('splits durations and shifts the right piece source window at 1x', () => {
		const item = videoItem({ durationInFrames: 60, sourceStart: 300, sourceFps: 30, speed: 1 });
		timelineStore._setItems([item]);

		const result = timelineStore._splitItem(item.id, item.from + 18);
		expect(result).not.toBeNull();
		if (!result) return;
		expect(result.leftItem.durationInFrames).toBe(18);
		expect(result.rightItem.durationInFrames).toBe(42);
		expect(result.rightItem.sourceStart).toBe(300 + 18);
		expect(result.rightItem.from).toBe(item.from + 18);
	});

	it('refuses to split outside the item span', () => {
		const item = videoItem();
		timelineStore._setItems([item]);
		expect(timelineStore._splitItem(item.id, item.from)).toBeNull();
		expect(timelineStore._splitItem(item.id, item.from + item.durationInFrames)).toBeNull();
	});
});
