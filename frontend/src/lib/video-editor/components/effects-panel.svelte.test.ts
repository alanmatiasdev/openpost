import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { clearEffectDragData, getEffectDragData } from '$lib/video-editor/timeline/effect-drop';
import { getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
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

describe('EffectsPanel typed GPU controls', () => {
	it('renders the ASCII control surface and commits conditional choices', async () => {
		timelineStore.setAll({
			tracks: [videoTrack],
			items: [
				{
					...videoItem,
					effects: [
						{
							id: 'ascii-effect',
							type: 'gpu',
							effectId: 'gpu-ascii',
							enabled: true,
							params: getGpuEffectDefaultParams('gpu-ascii')
						}
					]
				}
			],
			fps: 30
		});
		const onedit = vi.fn();
		const screen = await render(EffectsPanel, { itemId: 'video', onedit });

		await expect.element(screen.getByText('Character Set', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('Font Size', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('Background', { exact: true })).toBeVisible();
		expect(screen.getByText('Text Color', { exact: true }).query()).toBeNull();

		const matchSource = document.querySelector('[aria-label="ASCII: Match Source Color"]');
		expect(matchSource).toBeInstanceOf(HTMLElement);
		if (!(matchSource instanceof HTMLElement)) throw new Error('match-source checkbox missing');
		matchSource.click();
		await vi.waitFor(() => {
			const effect = timelineStore.itemById.get('video')?.effects?.[0];
			expect(effect?.type === 'gpu' ? effect.params.matchSourceColor : undefined).toBe(false);
		});
		await expect.element(screen.getByText('Text Color', { exact: true })).toBeVisible();
		const colorHex = document.querySelector('[aria-label="ASCII: Text Color hex"]');
		expect(colorHex).toBeInstanceOf(HTMLInputElement);
		if (!(colorHex instanceof HTMLInputElement)) throw new Error('text color input missing');
		colorHex.value = '#12345678';
		colorHex.dispatchEvent(new InputEvent('input', { bubbles: true }));
		colorHex.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		await vi.waitFor(() => {
			const effect = timelineStore.itemById.get('video')?.effects?.[0];
			expect(effect?.type === 'gpu' ? effect.params.textColor : undefined).toBe('#12345678');
		});
		expect(onedit).toHaveBeenCalledTimes(2);
	});
});
