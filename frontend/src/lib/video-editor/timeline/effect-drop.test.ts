import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import {
	areItemIdListsEqual,
	canApplyDroppedEffectsToItem,
	isDragPointInsideElement,
	resolveEffectDropTargetIds
} from './effect-drop';

function item(id: string, type: TimelineItem['type']): TimelineItem {
	return {
		id,
		trackId: type === 'audio' ? 'audio-track' : 'video-track',
		from: 0,
		durationInFrames: 30,
		label: id,
		type
	};
}

describe('effect drop targets', () => {
	it('targets the hovered clip unless it belongs to a compatible multi-selection', () => {
		const items = [item('video', 'video'), item('audio', 'audio'), item('title', 'text')];

		expect(
			resolveEffectDropTargetIds({
				hoveredItemId: 'video',
				items,
				selectedItemIds: ['title']
			})
		).toEqual(['video']);
		expect(
			resolveEffectDropTargetIds({
				hoveredItemId: 'video',
				items,
				selectedItemIds: ['video', 'audio', 'title']
			})
		).toEqual(['video', 'title']);
	});

	it('rejects audio and detects true drag exits from clip bounds', () => {
		expect(areItemIdListsEqual(['video', 'title'], ['video', 'title'])).toBe(true);
		expect(areItemIdListsEqual(['video', 'title'], ['title', 'video'])).toBe(false);
		expect(canApplyDroppedEffectsToItem(item('audio', 'audio'))).toBe(false);
		expect(canApplyDroppedEffectsToItem(item('subtitle', 'subtitle'))).toBe(true);
		// SAFETY: this test double implements the only HTMLElement method used by the helper.
		const element = {
			getBoundingClientRect: () => ({ left: 10, right: 110, top: 20, bottom: 120 })
		} as HTMLElement;
		expect(isDragPointInsideElement({ clientX: 50, clientY: 50 }, element)).toBe(true);
		expect(isDragPointInsideElement({ clientX: 5, clientY: 50 }, element)).toBe(false);
	});
});
