import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import TextMotionPanel from './text-motion-panel.svelte';

const track: TimelineTrack = {
	id: 'visual',
	name: 'Visual',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

function item(id: string): TimelineItem {
	return {
		id,
		trackId: track.id,
		from: 0,
		durationInFrames: 60,
		label: id,
		text: 'Open Post',
		type: 'text'
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore.setAll({ tracks: [track], items: [item('one'), item('two')], fps: 30 });
});

describe('TextMotionPanel', () => {
	it('shows all 17 presets in three independent slots', async () => {
		const screen = await render(TextMotionPanel, {
			itemId: 'one',
			itemIds: ['one'],
			onedit: vi.fn()
		});
		expect(document.querySelectorAll('.preset-grid button')).toHaveLength(17);
		expect(screen.getByText('In', { exact: true })).toBeVisible();
		expect(screen.getByText('Out', { exact: true })).toBeVisible();
		expect(screen.getByText('Loop', { exact: true })).toBeVisible();
	});

	it('applies and removes the active preset across selected text clips', async () => {
		const onedit = vi.fn();
		const screen = await render(TextMotionPanel, {
			itemId: 'one',
			itemIds: ['one', 'two'],
			onedit
		});
		await screen.getByRole('button', { name: 'Rise' }).click();
		expect(timelineStore.itemById.get('one')?.textMotion?.in?.presetId).toBe('rise');
		expect(timelineStore.itemById.get('two')?.textMotion?.in?.presetId).toBe('rise');
		expect(commandHistory.undoStack).toHaveLength(1);
		await screen.getByRole('button', { name: 'Remove Rise' }).click();
		expect(timelineStore.itemById.get('one')?.textMotion).toBeUndefined();
		expect(onedit).toHaveBeenCalledTimes(2);
	});

	it('coalesces a slider gesture and commits unit and order changes', async () => {
		const screen = await render(TextMotionPanel, {
			itemId: 'one',
			itemIds: ['one'],
			onedit: vi.fn()
		});
		await screen.getByRole('button', { name: 'Wave', exact: true }).click();
		commandHistory.clearHistory();
		const intensity = document.querySelector<HTMLInputElement>('[data-slot="loop"] input[max="2"]');
		expect(intensity).not.toBeNull();
		if (!intensity) return;
		intensity.value = '0.8';
		intensity.dispatchEvent(new InputEvent('input', { bubbles: true }));
		intensity.value = '0.35';
		intensity.dispatchEvent(new InputEvent('input', { bubbles: true }));
		intensity.dispatchEvent(new Event('change', { bubbles: true }));
		expect(commandHistory.undoStack).toHaveLength(1);
		const selects = document.querySelectorAll<HTMLSelectElement>('[data-slot="loop"] select');
		selects[0]!.value = 'word';
		selects[0]!.dispatchEvent(new Event('change', { bubbles: true }));
		selects[1]!.value = 'center';
		selects[1]!.dispatchEvent(new Event('change', { bubbles: true }));
		expect(timelineStore.itemById.get('one')?.textMotion?.loop).toMatchObject({
			intensity: 0.35,
			unit: 'word',
			order: 'center'
		});
		expect(commandHistory.undoStack).toHaveLength(3);
	});
});
