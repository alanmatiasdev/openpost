import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { get } from 'svelte/store';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { timelinePreviewScrub } from '$lib/video-editor/preview/timeline-preview-scrub';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import '../../../routes/layout.css';
import ColorGradingDock from './color-grading-dock.svelte';

const track: TimelineTrack = {
	id: 'video-track',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	volume: 1,
	order: 0
};

const item: TimelineItem = {
	id: 'video',
	trackId: track.id,
	from: 0,
	durationInFrames: 60,
	label: 'Video',
	type: 'video'
};

const cutawayTrack: TimelineTrack = {
	...track,
	id: 'cutaway-track',
	name: 'Cutaway',
	order: 1
};

const cutaway: TimelineItem = {
	...item,
	id: 'cutaway',
	trackId: cutawayTrack.id,
	from: 90,
	label: 'Cutaway'
};

beforeEach(() => {
	timelineStore.__resetForTesting();
	timelinePreviewScrub.__resetForTesting();
	timelineStore.setAll({
		tracks: [track, cutawayTrack],
		items: [item, cutaway],
		fps: 30,
		inPoint: 30,
		outPoint: 150,
		markers: [{ id: 'beat', frame: 45, label: 'Beat', color: '#ef4444' }]
	});
});

afterEach(async () => {
	await page.viewport(1280, 900);
});

test('fits primary wheels, curves, effects, and keyframes into one grading dock', async () => {
	const screen = await render(ColorGradingDock, { itemId: item.id, onedit: vi.fn() });

	await expect.element(screen.getByRole('region', { name: 'Color grading' })).toBeVisible();
	await expect.element(screen.getByRole('region', { name: 'Timeline overview' })).toBeVisible();
	await expect.element(screen.getByText('Effects', { exact: true })).toBeVisible();
	await expect.element(screen.getByRole('region', { name: 'Curves' })).toBeVisible();
	await expect.element(screen.getByRole('region', { name: 'Keyframes' })).toBeVisible();
	expect(screen.getByRole('slider', { name: /color wheel$/ }).elements()).toHaveLength(4);
	expect(document.querySelector('[data-color-scope-canvas]')).toBeNull();
	expect(screen.getByText('Color workspace', { exact: true }).elements()).toHaveLength(1);
});

test('selects clips and markers and commits only the final overview scrub frame', async () => {
	const onselectitem = vi.fn();
	const screen = await render(ColorGradingDock, {
		itemId: item.id,
		itemIds: [item.id],
		onedit: vi.fn(),
		onselectitem
	});

	expect(document.querySelectorAll('[data-color-film-tile]')).toHaveLength(2);
	expect(document.querySelectorAll('[data-color-mini-clip]')).toHaveLength(2);
	expect(document.querySelector('[data-color-timeline-range]')).not.toBeNull();

	document.querySelector<HTMLButtonElement>('[data-color-film-tile="cutaway"]')?.click();
	await vi.waitFor(() => {
		expect(timelineStore.currentFrame).toBe(90);
		expect(onselectitem).toHaveBeenCalledWith('cutaway');
	});

	document.querySelector<HTMLButtonElement>('[data-color-timeline-marker="beat"]')?.click();
	await vi.waitFor(() => {
		expect(timelineStore.currentFrame).toBe(45);
		expect(timelineStore.selectedMarkerId).toBe('beat');
	});

	const playhead = screen.getByRole('slider', { name: 'Timeline playhead' });
	await expect.element(playhead).toBeVisible();
	const playheadElement = playhead.element();
	expect(playheadElement.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
	const scrubSurface = document.querySelector<HTMLElement>('[data-color-timeline-scrub]');
	expect(scrubSurface).not.toBeNull();
	if (!scrubSurface) return;
	vi.spyOn(scrubSurface, 'getBoundingClientRect').mockReturnValue({
		left: 100,
		right: 600,
		top: 0,
		bottom: 98,
		width: 500,
		height: 98,
		x: 100,
		y: 0,
		toJSON: () => ({})
	});
	scrubSurface.setPointerCapture = vi.fn();
	scrubSurface.hasPointerCapture = vi.fn(() => false);
	scrubSurface.dispatchEvent(
		new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 258, pointerId: 7 })
	);
	expect(get(timelinePreviewScrub).frame).toBe(75);
	expect(timelineStore.currentFrame).toBe(45);
	scrubSurface.dispatchEvent(
		new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 486, pointerId: 7 })
	);
	expect(timelineStore.currentFrame).toBe(225);
	expect(get(timelinePreviewScrub).frame).toBeNull();
	playheadElement.dispatchEvent(
		new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft', shiftKey: true })
	);
	expect(timelineStore.currentFrame).toBe(215);
});

test('uses a fitted three-column grading surface at desktop width', async () => {
	await page.viewport(1280, 900);
	const screen = await render(ColorGradingDock, { itemId: item.id, onedit: vi.fn() });
	const panels = document.querySelector<HTMLElement>('[data-color-dock-panels]');
	expect(panels).not.toBeNull();
	if (!panels) return;
	const columns = getComputedStyle(panels).gridTemplateColumns.split(' ');

	expect(columns).toHaveLength(3);
	expect(columns.every((column) => Number.parseFloat(column) > 0)).toBe(true);
});

test('stacks without horizontal overflow at 320px', async () => {
	await page.viewport(320, 720);
	const screen = await render(ColorGradingDock, { itemId: item.id, onedit: vi.fn() });
	const dock = screen.getByRole('region', { name: 'Color grading' }).element();

	expect(dock.scrollWidth).toBeLessThanOrEqual(dock.clientWidth);
	expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);

	await page.viewport(390, 780);
	expect(dock.scrollWidth).toBeLessThanOrEqual(dock.clientWidth);
	expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
});
