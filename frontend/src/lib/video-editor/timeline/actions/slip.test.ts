import { beforeEach, describe, expect, it } from 'vitest';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { slipItem } from './items';

describe('slipItem', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	});

	it('shifts the source window without moving the item', () => {
		timelineStore._setItems([
			{
				id: 'a',
				trackId: 't',
				from: 100,
				durationInFrames: 30,
				label: '',
				type: 'video',
				sourceStart: 60,
				sourceEnd: 90,
				sourceDuration: 300
			}
		]);
		slipItem('a', 15);
		const item = timelineStore.itemById.get('a')!;
		expect(item.from).toBe(100);
		expect(item.sourceStart).toBe(75);
		expect(item.sourceEnd).toBe(105);
		expect(commandHistory.undoStack.length).toBe(1);
	});

	it('clamps at both edges of the source material', () => {
		timelineStore._setItems([
			{
				id: 'a',
				trackId: 't',
				from: 0,
				durationInFrames: 30,
				label: '',
				type: 'video',
				sourceStart: 10,
				sourceEnd: 40,
				sourceDuration: 45
			}
		]);
		slipItem('a', -50);
		let item = timelineStore.itemById.get('a')!;
		expect(item.sourceStart).toBe(0);
		slipItem('a', 500);
		item = timelineStore.itemById.get('a')!;
		expect(item.sourceStart).toBe(15);
		expect(item.sourceEnd).toBe(45);
	});

	it('undoes back to the original window', () => {
		timelineStore._setItems([
			{
				id: 'a',
				trackId: 't',
				from: 0,
				durationInFrames: 20,
				label: '',
				type: 'video',
				sourceStart: 40,
				sourceEnd: 60,
				sourceDuration: 200
			}
		]);
		slipItem('a', 25);
		commandHistory.undo();
		const item = timelineStore.itemById.get('a')!;
		expect(item.sourceStart).toBe(40);
		expect(item.sourceEnd).toBe(60);
	});
});
