import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import ClipPropertiesPanel from './clip-properties-panel.svelte';

const tracks: TimelineTrack[] = [
	{
		id: 'video',
		name: 'Video 1',
		kind: 'video',
		height: 96,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0
	},
	{
		id: 'audio',
		name: 'Audio 1',
		kind: 'audio',
		height: 72,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 1
	}
];

const items: TimelineItem[] = [
	{
		id: 'video-item',
		trackId: 'video',
		from: 0,
		durationInFrames: 90,
		label: 'Interview',
		type: 'video',
		mediaId: 'media',
		linkedGroupId: 'linked',
		sourceStart: 30,
		sourceEnd: 120,
		sourceFps: 30
	},
	{
		id: 'audio-item',
		trackId: 'audio',
		from: 0,
		durationInFrames: 90,
		label: 'Interview audio',
		type: 'audio',
		mediaId: 'media',
		linkedGroupId: 'linked',
		sourceStart: 30,
		sourceEnd: 120,
		sourceFps: 30
	}
];

beforeEach(() => {
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks, items, currentFrame: 0, fps: 30 });
	commandHistory.clearHistory();
});

describe('ClipPropertiesPanel reverse playback', () => {
	it('shows the playback state and reverses linked A/V in one undoable edit', async () => {
		const onedit = vi.fn();
		const screen = await render(ClipPropertiesPanel, { itemId: 'video-item', onedit });
		const reverse = screen.getByRole('button', { name: 'Reverse clip' });

		await expect.element(reverse).toHaveAttribute('aria-pressed', 'false');
		await reverse.click();

		await expect.element(reverse).toHaveAttribute('aria-pressed', 'true');
		expect(timelineStore.items.map((item) => item.isReversed)).toEqual([true, true]);
		expect(onedit).toHaveBeenCalledOnce();
		expect(commandHistory.getLastCommandType()).toBe('SET_ITEMS_REVERSED');

		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.isReversed)).toEqual([undefined, undefined]);
	});
});
