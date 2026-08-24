import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions-store.svelte';
import { BENTO_PRESETS_STORAGE_KEY } from '$lib/video-editor/timeline/bento-presets';
import BentoLayoutDialog from './bento-layout-dialog.svelte';

function track(): TimelineTrack {
	return {
		id: 'visual',
		name: 'Visual',
		kind: 'video',
		height: 96,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		volume: 1,
		order: 0
	};
}

function item(id: string, label: string): TimelineItem {
	return {
		id,
		trackId: 'visual',
		from: 0,
		durationInFrames: 60,
		label,
		type: 'video',
		mediaId: `media-${id}`,
		sourceStart: 0,
		sourceEnd: 60,
		sourceWidth: 1920,
		sourceHeight: 1080,
		transform: { width: 800, height: 450 }
	};
}

describe('BentoLayoutDialog', () => {
	beforeEach(() => {
		localStorage.removeItem(BENTO_PRESETS_STORAGE_KEY);
		timelineStore.__resetForTesting();
		timelineStore._setTracks([track()]);
		timelineStore._setItems([item('a', 'Opening'), item('b', 'Cutaway'), item('c', 'Host')]);
		transitionsStore.setAll([
			{
				id: 'a-b',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'a',
				toItemId: 'b'
			}
		]);
		commandHistory.clearHistory();
	});

	it('previews transition chains, reorders cells, and applies one undoable layout', async () => {
		const onapplied = vi.fn();
		const screen = await render(BentoLayoutDialog, {
			open: true,
			itemIds: ['a', 'b', 'c'],
			canvasWidth: 1280,
			canvasHeight: 720,
			onapplied
		});

		await expect.element(screen.getByRole('dialog')).toBeVisible();
		await expect.element(screen.getByRole('group', { name: 'Layout preview' })).toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: '1. Opening + Cutaway' }))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: '2. Host' })).toBeVisible();
		await screen.getByRole('button', { name: 'Picture in picture' }).click();
		await screen.getByRole('button', { name: 'Move Host earlier' }).click();
		await screen.getByRole('button', { name: 'Apply layout' }).click();

		expect(onapplied).toHaveBeenCalledWith(['c', 'a', 'b']);
		expect(timelineStore.itemById.get('a')?.transform).toEqual(
			timelineStore.itemById.get('b')?.transform
		);
		expect(timelineStore.itemById.get('c')?.transform).toMatchObject({
			x: 0,
			y: 0,
			width: 1280,
			height: 720
		});
		expect(commandHistory.getLastCommandType()).toBe('APPLY_BENTO_LAYOUT');
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
	});

	it('saves, selects, and removes validated custom presets', async () => {
		const screen = await render(BentoLayoutDialog, {
			open: true,
			itemIds: ['a', 'c'],
			canvasWidth: 1280,
			canvasHeight: 720
		});
		await screen.getByRole('button', { name: 'Side by side' }).click();
		await screen.getByRole('button', { name: 'New preset' }).click();
		await screen.getByRole('textbox', { name: 'Preset name' }).fill('Interview pair');
		await screen.getByRole('button', { name: 'Save preset' }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Interview pair', exact: true }))
			.toBeVisible();
		expect(localStorage.getItem(BENTO_PRESETS_STORAGE_KEY)).toContain('Interview pair');

		await screen.getByRole('button', { name: 'Delete Interview pair preset' }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Interview pair', exact: true }))
			.not.toBeInTheDocument();
		expect(localStorage.getItem(BENTO_PRESETS_STORAGE_KEY)).toBe('[]');
	});
});
