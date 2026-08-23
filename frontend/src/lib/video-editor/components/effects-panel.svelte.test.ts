import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { clearEffectDragData, getEffectDragData } from '$lib/video-editor/timeline/effect-drop';
import { getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
import { ensureEffectPreviewPipeline } from '$lib/video-editor/effects/preview/effect-preview-engine';
import { EFFECT_PRESETS_STORAGE_KEY } from '$lib/video-editor/effects/effect-presets';
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
	localStorage.removeItem(EFFECT_PRESETS_STORAGE_KEY);
	timelineStore.__resetForTesting();
	timelineStore.setAll({
		tracks: [videoTrack],
		items: [{ ...videoItem, effects: undefined }],
		fps: 30
	});
});

describe('EffectsPanel effect drag source', () => {
	it('shows real lazily-rendered previews in the searchable effect picker', async () => {
		await render(EffectsPanel, { itemId: 'video', onedit: vi.fn() });
		const picker = document.querySelector<HTMLButtonElement>(
			'button[aria-expanded][aria-label="Add effect"]'
		);
		expect(picker).not.toBeNull();
		picker!.click();
		expect(await ensureEffectPreviewPipeline()).not.toBeNull();

		await vi.waitFor(() => {
			expect(document.querySelector('[data-effect-option="brightness"] canvas')).not.toBeNull();
			expect(
				document.querySelector('[data-effect-option="gpu:gpu-brightness"] canvas')
			).not.toBeNull();
		});
		const cssCanvas = document.querySelector<HTMLCanvasElement>(
			'[data-effect-option="brightness"] canvas'
		);
		await vi.waitFor(() => expect(cssCanvas?.dataset.renderMode).toBe('css'));
		expect(cssCanvas?.dataset.rendered).toBe('true');

		const search = document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
		expect(search).not.toBeNull();
		search!.value = 'pixelate';
		search!.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await vi.waitFor(() => {
			expect(document.querySelector('[data-effect-option="gpu:gpu-pixelate"]')).not.toBeNull();
			expect(document.querySelector('[data-effect-option="brightness"]')).toBeNull();
		});
		const gpuCanvas = document.querySelector<HTMLCanvasElement>(
			'[data-effect-option="gpu:gpu-pixelate"] canvas'
		);
		await vi.waitFor(() => expect(gpuCanvas?.dataset.renderMode).toBe('gpu'), {
			timeout: 10_000
		});
		const pixels = gpuCanvas?.getContext('2d')?.getImageData(0, 0, 4, 4).data;
		expect(pixels && [...pixels].some((channel) => channel !== 0)).toBe(true);
	});

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

	it('applies an exact built-in stack to every selected clip as one edit', async () => {
		timelineStore.setAll({
			tracks: [videoTrack],
			items: [videoItem, { ...videoItem, id: 'video-2', from: 90, label: 'Video 2' }],
			fps: 30
		});
		const onedit = vi.fn();
		const screen = await render(EffectsPanel, {
			itemId: 'video',
			itemIds: ['video', 'video-2'],
			onedit
		});
		document
			.querySelector<HTMLButtonElement>('button[aria-expanded][aria-label="Add effect"]')!
			.click();
		let presetSearch: HTMLInputElement | null = null;
		await vi.waitFor(() => {
			presetSearch = document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
			expect(presetSearch).not.toBeNull();
		});
		presetSearch!.value = 'Noir';
		presetSearch!.dispatchEvent(new InputEvent('input', { bubbles: true }));
		let noir: HTMLElement | null = null;
		await vi.waitFor(() => {
			noir = document.querySelector<HTMLElement>('[data-effect-option="preset:noir"]');
			expect(noir).not.toBeNull();
			expect(noir?.querySelector<HTMLCanvasElement>('canvas')?.dataset.renderMode).toBe('gpu');
		});
		await screen.getByText('Noir', { exact: true }).click();
		await screen.getByText('Add effect', { exact: true }).click();

		await vi.waitFor(() => {
			for (const id of ['video', 'video-2']) {
				expect(timelineStore.itemById.get(id)?.effects).toMatchObject([
					{
						type: 'gpu',
						effectId: 'gpu-grayscale',
						params: { amount: 1 },
						enabled: true
					},
					{
						type: 'gpu',
						effectId: 'gpu-contrast',
						params: { amount: 1.3 },
						enabled: true
					}
				]);
			}
		});
		expect(onedit).toHaveBeenCalledTimes(1);
	});

	it('saves, previews, and deletes a full user effect preset', async () => {
		timelineStore.setAll({
			items: [
				{
					...videoItem,
					effects: [
						{ id: 'blur', type: 'blur', amount: 7, enabled: false },
						{
							id: 'contrast',
							type: 'gpu',
							effectId: 'gpu-contrast',
							params: { amount: 1.7 },
							enabled: true
						}
					]
				}
			]
		});
		const screen = await render(EffectsPanel, { itemId: 'video', onedit: vi.fn() });
		await screen.getByText('Save current effects as preset', { exact: true }).click();
		const name = document.querySelector<HTMLInputElement>('[aria-label="Preset name"]');
		expect(name).not.toBeNull();
		name!.value = 'My stack';
		name!.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await screen.getByText('Save', { exact: true }).click();

		await vi.waitFor(() => {
			const stored = localStorage.getItem(EFFECT_PRESETS_STORAGE_KEY);
			expect(stored).toContain('My stack');
			expect(stored).toContain('gpu-contrast');
		});
		document
			.querySelector<HTMLButtonElement>('button[aria-expanded][aria-label="Add effect"]')!
			.click();
		let presetSearch: HTMLInputElement | null = null;
		await vi.waitFor(() => {
			presetSearch = document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
			expect(presetSearch).not.toBeNull();
		});
		presetSearch!.value = 'My stack';
		presetSearch!.dispatchEvent(new InputEvent('input', { bubbles: true }));
		let userOption: HTMLElement | null = null;
		await vi.waitFor(() => {
			userOption = document.querySelector<HTMLElement>('[data-effect-option^="user-preset:"]');
			expect(userOption).not.toBeNull();
			expect(userOption?.querySelector<HTMLCanvasElement>('canvas')?.dataset.renderMode).toBe(
				'gpu'
			);
		});
		await screen.getByRole('button', { name: 'Delete preset My stack' }).click();
		await vi.waitFor(() => {
			expect(localStorage.getItem(EFFECT_PRESETS_STORAGE_KEY)).toBe('[]');
		});
	});
});

describe('EffectsPanel stack controls', () => {
	it('reorders, resets, bypasses, and removes an effect with one edit per action', async () => {
		timelineStore.setAll({
			items: [
				{
					...videoItem,
					effects: [
						{ id: 'brightness', type: 'brightness', amount: 1.8, enabled: true },
						{ id: 'contrast', type: 'contrast', amount: 1.25, enabled: true }
					]
				}
			]
		});
		const onedit = vi.fn();
		await render(EffectsPanel, { itemId: 'video', itemIds: ['video'], onedit });

		const brightness = document.querySelector<HTMLElement>('[data-effect-id="brightness"]');
		expect(brightness).not.toBeNull();
		brightness!.querySelector<HTMLButtonElement>('[aria-label="Move effect down"]')!.click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('video')?.effects?.map((effect) => effect.id)).toEqual([
				'contrast',
				'brightness'
			]);
		});

		brightness!
			.querySelector<HTMLButtonElement>('[aria-label="Reset effect to defaults"]')!
			.click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('video')?.effects?.[1]).toMatchObject({
				id: 'brightness',
				amount: 1.2
			});
		});

		const contrast = document.querySelector<HTMLElement>('[data-effect-id="contrast"]');
		contrast!.querySelector<HTMLButtonElement>('[aria-label="Disable effect"]')!.click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('video')?.effects?.[0]?.enabled).toBe(false);
			expect(contrast?.dataset.enabled).toBe('false');
		});

		brightness!.querySelector<HTMLButtonElement>('[aria-label="Remove effect"]')!.click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('video')?.effects?.map((effect) => effect.id)).toEqual([
				'contrast'
			]);
		});
		expect(onedit).toHaveBeenCalledTimes(4);
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
