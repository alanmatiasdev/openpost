import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
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

beforeEach(() => {
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [item], fps: 30 });
});

afterEach(async () => {
	await page.viewport(1280, 900);
});

test('fits grade tools, the effect stack, and live scopes into one dock', async () => {
	const screen = await render(ColorGradingDock, { itemId: item.id, onedit: vi.fn() });

	await expect.element(screen.getByRole('region', { name: 'Color grading' })).toBeVisible();
	await expect.element(screen.getByText('Effects', { exact: true })).toBeVisible();
	expect(document.querySelector('[data-color-scope-canvas]')).not.toBeNull();
	expect(screen.getByText('Color workspace', { exact: true }).elements()).toHaveLength(1);
});

test('uses a fitted three-column grading surface at desktop width', async () => {
	await page.viewport(1280, 900);
	const screen = await render(ColorGradingDock, { itemId: item.id, onedit: vi.fn() });
	const dock = screen.getByRole('region', { name: 'Color grading' }).element();
	const columns = getComputedStyle(dock).gridTemplateColumns.split(' ');

	expect(columns).toHaveLength(3);
	expect(columns.every((column) => Number.parseFloat(column) > 0)).toBe(true);
});

test('stacks without horizontal overflow at 320px', async () => {
	await page.viewport(320, 720);
	const screen = await render(ColorGradingDock, { itemId: item.id, onedit: vi.fn() });
	const dock = screen.getByRole('region', { name: 'Color grading' }).element();

	expect(dock.scrollWidth).toBeLessThanOrEqual(dock.clientWidth);
	expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
});
