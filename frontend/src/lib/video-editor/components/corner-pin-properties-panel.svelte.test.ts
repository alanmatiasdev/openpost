import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import CornerPinPropertiesPanel from './corner-pin-properties-panel.svelte';

const track: TimelineTrack = {
	id: 'visual',
	name: 'Visual',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

function imageItem(): TimelineItem {
	return {
		id: 'image',
		trackId: track.id,
		from: 0,
		durationInFrames: 30,
		label: 'Image',
		type: 'image',
		transform: { width: 400, height: 200 }
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [imageItem()], currentFrame: 0, fps: 30 });
});

describe('CornerPinPropertiesPanel', () => {
	it('commits size-stable offsets, resets them, and fits a compact inspector', async () => {
		const onedit = vi.fn();
		const screen = await render(CornerPinPropertiesPanel, {
			item: timelineStore.itemById.get('image')!,
			onedit
		});
		screen.container.style.width = '260px';
		const inputs = screen.container.querySelectorAll<HTMLInputElement>('input[type="number"]');
		expect(inputs).toHaveLength(8);
		const first = inputs[0];
		if (!first) throw new Error('top-left X control did not render');
		first.value = '24';
		first.dispatchEvent(new Event('change', { bubbles: true }));
		expect(timelineStore.itemById.get('image')?.cornerPin).toMatchObject({
			topLeft: [24, 0],
			referenceWidth: 400,
			referenceHeight: 200
		});

		await screen.rerender({ item: timelineStore.itemById.get('image')! });
		await screen.getByRole('button', { name: 'Reset' }).click();
		expect(timelineStore.itemById.get('image')?.cornerPin).toBeUndefined();
		expect(onedit).toHaveBeenCalledTimes(2);
		const panel = screen.container.querySelector('section');
		if (!panel) throw new Error('corner pin inspector did not render');
		expect(panel.scrollWidth).toBeLessThanOrEqual(260);
	});
});
