import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { clearEffectDragData, getEffectDragData } from '$lib/video-editor/timeline/effect-drop';
import EffectsPanel from './effects-panel.svelte';

const videoTrack: TimelineTrack = {
	id: 'video-track',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const videoItem: TimelineItem = {
	id: 'video',
	trackId: videoTrack.id,
	from: 0,
	durationInFrames: 60,
	label: 'Video',
	type: 'video'
};

beforeEach(() => {
	clearEffectDragData();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [videoTrack], items: [videoItem], fps: 30 });
});

describe('EffectsPanel effect drag source', () => {
	it('only offers dragging when a clip is selected', async () => {
		const screen = await render(EffectsPanel, { itemId: null, onedit: vi.fn() });
		const addButton = screen.getByText('Add effect', { exact: true }).element();

		expect(addButton.hasAttribute('disabled')).toBe(true);
		expect(addButton.getAttribute('draggable')).toBe('false');
		expect(addButton.getAttribute('title')).toBe('Add effect');
	});

	it('publishes the selected effect for timeline dragover and clears it on drag end', async () => {
		const onedit = vi.fn();
		const screen = await render(EffectsPanel, { itemId: 'video', onedit });
		const addButton = screen.getByText('Add effect', { exact: true }).element();
		const dataTransfer = new DataTransfer();

		addButton.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
		expect(getEffectDragData()).toEqual({
			type: 'timeline-effect',
			label: 'Brightness',
			effects: [{ kind: 'css', effectType: 'brightness' }]
		});
		expect(JSON.parse(dataTransfer.getData('application/json'))).toEqual(getEffectDragData());
		expect(onedit).not.toHaveBeenCalled();

		addButton.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
		expect(getEffectDragData()).toBeNull();
	});
});
