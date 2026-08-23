import { beforeEach, describe, expect, it } from 'vitest';
import { keyframeSelectionStore } from './keyframe-selection-store.svelte';

describe('keyframeSelectionStore', () => {
	beforeEach(() => keyframeSelectionStore.clear());

	it('keeps one item-scoped selection for every keyframe editor', () => {
		keyframeSelectionStore.replace('clip-a', ['a', 'b']);
		expect([...keyframeSelectionStore.forItem('clip-a')]).toEqual(['a', 'b']);
		expect([...keyframeSelectionStore.forItem('clip-b')]).toEqual([]);
	});

	it('prunes identities that disappeared after an edit', () => {
		keyframeSelectionStore.replace('clip-a', ['a', 'b', 'c']);
		keyframeSelectionStore.prune('clip-a', new Set(['a', 'c']));
		expect([...keyframeSelectionStore.ids]).toEqual(['a', 'c']);
	});
});
