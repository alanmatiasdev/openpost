import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions-store.svelte';
import MotionPresetsPanel from './motion-presets-panel.svelte';

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

function item(id: string, overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id,
		trackId: track.id,
		from: 0,
		durationInFrames: 90,
		label: id,
		type: 'video',
		transform: { x: 100, y: 200, width: 400, height: 300, rotation: 0, opacity: 1 },
		...overrides
	};
}

function props(itemId = 'one', itemIds = ['one']) {
	return {
		itemId,
		itemIds,
		frameWidth: 1920,
		frameHeight: 1080,
		fps: 30,
		onedit: vi.fn()
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	transitionsStore.clear();
	timelineStore.setAll({ tracks: [track], items: [item('one')], fps: 30 });
});

describe('MotionPresetsPanel', () => {
	it('renders the full grouped catalog without auto-playing thumbnails', async () => {
		const screen = await render(MotionPresetsPanel, props());
		expect(document.querySelectorAll('.preset-group .preset-tile')).toHaveLength(20);
		expect(document.querySelectorAll('.live-tile')).toHaveLength(5);
		expect(screen.getByText('Entrance', { exact: true })).toBeVisible();
		expect(screen.getByText('Exit', { exact: true })).toBeVisible();
		expect(screen.getByText('Emphasis', { exact: true })).toBeVisible();
		const glyph = document.querySelector<HTMLElement>('.motion-glyph');
		expect(glyph).not.toBeNull();
		expect(getComputedStyle(glyph!).animationName).toBe('none');
	});

	it('attaches deterministic staggered live behavior to every selected clip', async () => {
		timelineStore.setAll({
			tracks: [track],
			items: [item('one'), item('two', { from: 100 })],
			fps: 30
		});
		const input = props('one', ['one', 'two']);
		const screen = await render(MotionPresetsPanel, input);
		const ranges = document.querySelectorAll<HTMLInputElement>('.generator-controls input');
		ranges[0]!.value = '2';
		ranges[0]!.dispatchEvent(new InputEvent('input', { bubbles: true }));
		ranges[1]!.value = '0.5';
		ranges[1]!.dispatchEvent(new InputEvent('input', { bubbles: true }));
		ranges[2]!.value = '4';
		ranges[2]!.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await screen.getByRole('button', { name: 'Apply live Float drift' }).click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('one')?.motionModifiers?.[0]).toMatchObject({
				type: 'float-drift',
				amplitude: 0.5,
				frequency: 0.3125,
				phaseFrames: 0,
				seed: 1
			});
			expect(timelineStore.itemById.get('two')?.motionModifiers?.[0]).toMatchObject({
				phaseFrames: 4,
				seed: 2
			});
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(input.onedit).toHaveBeenCalledTimes(1);
		expect(screen.getByText('Applied live Float drift to 2 clips.')).toBeVisible();
	});

	it('coalesces live behavior slider input and exposes per-channel gain', async () => {
		const input = props();
		const screen = await render(MotionPresetsPanel, input);
		await screen.getByRole('button', { name: 'Apply live Float drift' }).click();
		commandHistory.clearHistory();
		const ranges = document.querySelectorAll<HTMLInputElement>('.live-controls input');
		expect(ranges).toHaveLength(5);
		ranges[0]!.value = '0.8';
		ranges[0]!.dispatchEvent(new InputEvent('input', { bubbles: true }));
		ranges[0]!.value = '0.35';
		ranges[0]!.dispatchEvent(new InputEvent('input', { bubbles: true }));
		ranges[0]!.dispatchEvent(new Event('change', { bubbles: true }));
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('one')?.motionModifiers?.[0]?.amplitude).toBe(0.35);
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(input.onedit).toHaveBeenCalledTimes(2);
		expect(screen.getByText('Horizontal', { exact: true })).toBeVisible();
	});

	it('confirms and bakes live motion into editable keyframes', async () => {
		const input = props();
		const screen = await render(MotionPresetsPanel, input);
		await screen.getByRole('button', { name: 'Apply live Sway' }).click();
		expect(screen.getByText('Editable keyframes', { exact: true })).toBeVisible();
		await screen.getByRole('button', { name: 'Bake to keyframes' }).click();
		expect(screen.getByText(/replaces the live controls with keyframes/i)).toBeVisible();
		await screen.getByRole('button', { name: 'Bake motion' }).click();
		await vi.waitFor(() => {
			const baked = timelineStore.itemById.get('one');
			expect(baked?.motionModifiers).toBeUndefined();
			expect(baked?.keyframes?.rotation?.frames.at(-1)).toBe(89);
		});
		expect(commandHistory.undoStack).toHaveLength(2);
		expect(input.onedit).toHaveBeenCalledTimes(2);
		expect(screen.getByText(/Baked 1 clips into \d+ editable keyframes\./)).toBeVisible();
		expect(
			[...document.querySelectorAll('button')].some((button) =>
				button.textContent?.includes('Bake to keyframes')
			)
		).toBe(false);
	});

	it('removes parked animation only through the explicit cleanup action', async () => {
		timelineStore.setAll({
			items: [
				item('one', {
					durationInFrames: 10,
					keyframes: { opacity: { frames: [0, 20], values: [0, 1] } }
				})
			]
		});
		const input = props();
		const screen = await render(MotionPresetsPanel, input);
		expect(timelineStore.itemById.get('one')?.keyframes?.opacity?.frames).toEqual([0, 20]);
		expect(screen.getByText(/1 keyframes sit past/)).toBeVisible();
		await screen.getByRole('button', { name: 'Trim animation to clips' }).click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('one')?.keyframes?.opacity?.frames).toEqual([0, 9]);
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(input.onedit).toHaveBeenCalledTimes(1);
		expect(
			screen.getByText('Removed 1 parked keyframes and kept the final visible poses.')
		).toBeVisible();
	});

	it('applies tuned motion to every selected clip in one edit', async () => {
		timelineStore.setAll({
			tracks: [track],
			items: [item('one'), item('two', { from: 100 })],
			fps: 30
		});
		const input = props('one', ['one', 'two']);
		const screen = await render(MotionPresetsPanel, input);
		const ranges = document.querySelectorAll<HTMLInputElement>('input[type="range"]');
		expect(ranges).toHaveLength(3);
		ranges[0]!.value = '2';
		ranges[0]!.dispatchEvent(new InputEvent('input', { bubbles: true }));
		ranges[1]!.value = '0.5';
		ranges[1]!.dispatchEvent(new InputEvent('input', { bubbles: true }));
		ranges[2]!.value = '3';
		ranges[2]!.dispatchEvent(new InputEvent('input', { bubbles: true }));

		await screen.getByRole('button', { name: 'Replace Fade in' }).click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('one')?.keyframes?.opacity).toMatchObject({
				frames: [0, 30],
				values: [0.5, 1]
			});
			expect(timelineStore.itemById.get('two')?.keyframes?.opacity).toMatchObject({
				frames: [3, 33],
				values: [0.5, 1]
			});
		});
		expect(input.onedit).toHaveBeenCalledTimes(1);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(screen.getByText('Applied Fade in to 2 clips.')).toBeVisible();
	});

	it('switches to Add and preserves an authored collision', async () => {
		timelineStore.setAll({
			items: [
				item('one', {
					keyframes: { opacity: { frames: [0], values: [0.4], ids: ['authored'] } }
				})
			]
		});
		const input = props();
		const screen = await render(MotionPresetsPanel, input);
		await screen.getByRole('button', { name: 'Add', exact: true }).click();
		expect(
			screen.getByText('Keep authored diamonds and add only frames that are still free.')
		).toBeVisible();
		await screen.getByRole('button', { name: 'Add Fade in' }).click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('one')?.keyframes?.opacity).toMatchObject({
				frames: [0, 15],
				values: [0.4, 0.4],
				ids: ['authored', expect.any(String)]
			});
		});
		expect(input.onedit).toHaveBeenCalledTimes(1);
	});

	it('disables box-scale presets for text with a clear reason', async () => {
		timelineStore.setAll({ items: [item('one', { type: 'text', text: 'Headline' })] });
		await render(MotionPresetsPanel, props());
		const pop = document.querySelector<HTMLButtonElement>('button[aria-label="Replace Pop in"]');
		expect(pop).not.toBeNull();
		expect(pop?.disabled).toBe(true);
		expect(pop?.title).toBe('This preset changes the text box size and could reflow the text.');
		expect(
			document.querySelector<HTMLButtonElement>('button[aria-label="Replace Fade in"]')?.disabled
		).toBe(false);
		expect(
			document.querySelector<HTMLButtonElement>('button[aria-label="Apply live Breath pulse"]')
				?.disabled
		).toBe(true);
	});

	it('reports transition overlap without saving or partly applying', async () => {
		timelineStore.setAll({
			tracks: [track],
			items: [
				item('one', { durationInFrames: 30 }),
				item('two', { from: 30, durationInFrames: 30 })
			],
			fps: 30
		});
		transitionsStore.setAll([
			{
				id: 'cut',
				type: 'crossfade',
				durationInFrames: 12,
				fromItemId: 'one',
				toItemId: 'two'
			}
		]);
		const input = props('one', ['one', 'two']);
		const screen = await render(MotionPresetsPanel, input);
		await screen.getByRole('button', { name: 'Replace Fade out' }).click();
		expect(
			screen.getByText('The preset reaches frames owned by a transition, so no clips were changed.')
		).toBeVisible();
		expect(timelineStore.items.every((candidate) => candidate.keyframes === undefined)).toBe(true);
		expect(input.onedit).not.toHaveBeenCalled();
	});
});
