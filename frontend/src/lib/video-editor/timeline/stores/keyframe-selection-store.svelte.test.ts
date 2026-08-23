import { beforeEach, describe, expect, it } from 'vitest';
import { keyframeSelectionStore } from './keyframe-selection-store.svelte';

describe('keyframeSelectionStore', () => {
	beforeEach(() => {
		keyframeSelectionStore.clear();
		keyframeSelectionStore.clearClipboard();
	});

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

	it('copies normalized full-fidelity keyframes and marks cuts', () => {
		const item = {
			id: 'clip-a',
			trackId: 'video',
			from: 0,
			durationInFrames: 100,
			label: 'Clip',
			type: 'video' as const,
			keyframes: {
				opacity: {
					frames: [10, 30],
					values: [0, 1],
					ids: ['a', 'b'],
					easings: ['hold' as const, 'cubic-bezier' as const],
					easingConfigs: [
						null,
						{
							type: 'cubic-bezier' as const,
							bezier: { x1: 0.2, y1: 0.8, x2: 0.4, y2: 1 }
						}
					]
				},
				rotation: { frames: [20], values: [90], ids: ['c'] }
			}
		};
		expect(keyframeSelectionStore.copy(item, new Set(['a', 'c']), true)).toBe(true);
		expect(keyframeSelectionStore.clipboard).toMatchObject({
			sourceItemId: 'clip-a',
			originFrame: 10,
			keyframes: [
				{ property: 'opacity', frame: 0, value: 0, easing: 'hold' },
				{ property: 'rotation', frame: 10, value: 90, easing: 'linear' }
			]
		});
		expect(keyframeSelectionStore.isCut).toBe(true);
		keyframeSelectionStore.clearClipboard();
		expect(keyframeSelectionStore.clipboard).toBeNull();
		expect(keyframeSelectionStore.isCut).toBe(false);
	});
});
