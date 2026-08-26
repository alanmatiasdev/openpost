import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { QuickCutSource } from '../types';
import { createSegment } from '../model';
import SegmentList from './SegmentList.svelte';
import '../../../routes/layout.css';

const source: QuickCutSource = {
	id: 'source',
	name: 'Interview.mp4',
	size: 1024,
	mimeType: 'video/mp4',
	duration: 10,
	width: 1920,
	height: 1080,
	videoCodec: 'avc',
	audioCodec: 'aac',
	sampleRate: 48_000,
	channels: 2,
	rotation: 0,
	fps: 30,
	keyframeTimestamps: [0, 2, 4],
	keyframeState: 'known'
};

afterEach(async () => {
	await page.viewport(1280, 900);
});

test('edits one segment cut strategy without changing the project default', async () => {
	const onUpdate = vi.fn();
	const screen = await render(SegmentList, {
		segments: [createSegment(0.5, 2, { id: 'range', sourceId: source.id })],
		sources: [source],
		selectedId: 'range',
		defaultCutMode: 'nearestKeyframe',
		onSelect: vi.fn(),
		onRemove: vi.fn(),
		onUpdate,
		onMove: vi.fn()
	});

	const strategy = screen.getByRole('combobox', { name: 'Cut mode 1' });
	await expect.element(strategy).toHaveValue('');
	expect(strategy.element().querySelector('option[value=""]')?.textContent?.trim()).toBe(
		'Project mode: Nearest keyframe (lossless)'
	);

	await strategy.selectOptions('exact');
	expect(onUpdate).toHaveBeenCalledExactlyOnceWith('range', { cutMode: 'exact' });
});

test('keeps the per-segment strategy usable without phone overflow', async () => {
	await page.viewport(320, 720);
	const screen = await render(SegmentList, {
		segments: [createSegment(0.5, 2, { id: 'range', sourceId: source.id, cutMode: 'exact' })],
		sources: [source],
		selectedId: 'range',
		defaultCutMode: 'nearestKeyframe',
		onSelect: vi.fn(),
		onRemove: vi.fn(),
		onUpdate: vi.fn(),
		onMove: vi.fn()
	});

	await expect.element(screen.getByRole('combobox', { name: 'Cut mode 1' })).toBeVisible();
	expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
});
