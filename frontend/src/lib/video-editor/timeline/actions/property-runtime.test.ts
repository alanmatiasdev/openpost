import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import {
	removeDirectPropertyLink,
	removePropertyExpression,
	setDirectPropertyLink,
	setPropertyExpression
} from './property-runtime';
import { duplicateItems } from './items';

function item(id: string, overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id,
		trackId: 'visual',
		from: 0,
		durationInFrames: 60,
		label: id,
		type: 'shape',
		...overrides
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore._setItems([item('one'), item('two')]);
});

describe('property runtime actions', () => {
	it('sets, replaces, removes, and undoes a direct link', () => {
		expect(
			setDirectPropertyLink('one', {
				type: 'link',
				targetProperty: 'x',
				sourceItemId: 'two',
				sourceProperty: 'x',
				enabled: true,
				timeOffsetFrames: 0
			})
		).toEqual({ ok: true });
		expect(timelineStore.itemById.get('one')?.propertyLinks).toHaveLength(1);
		expect(removeDirectPropertyLink('one', 'x')).toBe(true);
		expect(timelineStore.itemById.get('one')?.propertyLinks).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(2);
		commandHistory.undo();
		expect(timelineStore.itemById.get('one')?.propertyLinks?.[0]?.sourceItemId).toBe('two');
	});

	it('rejects incompatible shapes and dependency cycles before mutation', () => {
		expect(
			setDirectPropertyLink('one', {
				type: 'link',
				targetProperty: 'position',
				sourceItemId: 'two',
				sourceProperty: 'x',
				enabled: true,
				timeOffsetFrames: 0
			})
		).toEqual({ ok: false, reason: 'incompatible' });
		setDirectPropertyLink('one', {
			type: 'link',
			targetProperty: 'x',
			sourceItemId: 'two',
			sourceProperty: 'x',
			enabled: true,
			timeOffsetFrames: 0
		});
		expect(
			setDirectPropertyLink('two', {
				type: 'link',
				targetProperty: 'x',
				sourceItemId: 'one',
				sourceProperty: 'x',
				enabled: true,
				timeOffsetFrames: 0
			})
		).toEqual({ ok: false, reason: 'cycle' });
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('sets, toggles, removes, and restores expressions', () => {
		expect(
			setPropertyExpression('one', {
				type: 'expression',
				targetProperty: 'x',
				source: 'value * 2',
				enabled: true
			})
		).toBe(true);
		setPropertyExpression('one', {
			type: 'expression',
			targetProperty: 'x',
			source: 'value * 2',
			enabled: false
		});
		expect(timelineStore.itemById.get('one')?.expressions).toMatchObject([{ enabled: false }]);
		expect(removePropertyExpression('one', 'x')).toBe(true);
		expect(timelineStore.itemById.get('one')?.expressions).toBeUndefined();
		commandHistory.undo();
		expect(timelineStore.itemById.get('one')?.expressions).toMatchObject([{ enabled: false }]);
	});

	it('remaps links inside a duplicated group but preserves links to original layers', () => {
		setDirectPropertyLink('one', {
			type: 'link',
			targetProperty: 'x',
			sourceItemId: 'two',
			sourceProperty: 'x',
			enabled: true,
			timeOffsetFrames: 0
		});
		const [duplicatedFollowerId, duplicatedSourceId] = duplicateItems(['one', 'two']);
		expect(duplicatedFollowerId).toBeDefined();
		expect(duplicatedSourceId).toBeDefined();
		expect(
			duplicatedFollowerId
				? timelineStore.itemById.get(duplicatedFollowerId)?.propertyLinks?.[0]?.sourceItemId
				: undefined
		).toBe(duplicatedSourceId);

		const [singleFollowerId] = duplicateItems(['one']);
		expect(singleFollowerId).toBeDefined();
		expect(
			singleFollowerId
				? timelineStore.itemById.get(singleFollowerId)?.propertyLinks?.[0]?.sourceItemId
				: undefined
		).toBe('two');
	});
});
