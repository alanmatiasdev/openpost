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
	},
	{
		id: 'text-item',
		trackId: 'video',
		from: 120,
		durationInFrames: 90,
		label: 'Launch',
		text: 'Launch',
		type: 'text',
		backgroundColor: '#221100',
		fontSize: 84,
		fontWeight: 700
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
		expect(timelineStore.items.map((item) => item.isReversed)).toEqual([true, true, undefined]);
		expect(onedit).toHaveBeenCalledOnce();
		expect(commandHistory.getLastCommandType()).toBe('SET_ITEMS_REVERSED');

		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.isReversed)).toEqual([
			undefined,
			undefined,
			undefined
		]);
	});

	it('retimes linked media and edits the audible companion from the video inspector', async () => {
		const onedit = vi.fn();
		const screen = await render(ClipPropertiesPanel, { itemId: 'video-item', onedit });

		const speed = screen.getByRole('spinbutton', { name: 'Speed' }).query();
		if (!(speed instanceof HTMLInputElement)) throw new Error('Speed control did not render.');
		speed.value = '2';
		speed.dispatchEvent(new Event('change', { bubbles: true }));

		expect(timelineStore.itemById.get('video-item')).toMatchObject({
			speed: 2,
			durationInFrames: 45
		});
		expect(timelineStore.itemById.get('audio-item')).toMatchObject({
			speed: 2,
			durationInFrames: 45
		});
		const gain = screen.container.querySelector('input[min="-60"]');
		if (!(gain instanceof HTMLInputElement)) throw new Error('Gain control did not render.');
		gain.value = '-6';
		gain.dispatchEvent(new Event('change', { bubbles: true }));
		expect(timelineStore.itemById.get('audio-item')?.volume).toBeCloseTo(0.501187, 5);
		expect(timelineStore.itemById.get('video-item')?.volume).toBeUndefined();

		await screen.getByRole('button', { name: 'Flip X' }).click();
		expect(timelineStore.itemById.get('video-item')?.transform?.flipHorizontal).toBe(true);
		expect(onedit).toHaveBeenCalledTimes(3);
	});
});

describe('ClipPropertiesPanel text styling', () => {
	it('edits complete block typography without losing related shadow values', async () => {
		const onedit = vi.fn();
		const screen = await render(ClipPropertiesPanel, { itemId: 'text-item', onedit });

		const shadowX = screen.getByRole('spinbutton', { name: 'Shadow X' }).query();
		if (!(shadowX instanceof HTMLInputElement)) {
			throw new Error('Shadow X control did not render.');
		}
		shadowX.value = '12';
		shadowX.dispatchEvent(new Event('change', { bubbles: true }));

		const shadowY = screen.getByRole('spinbutton', { name: 'Shadow Y' }).query();
		if (!(shadowY instanceof HTMLInputElement)) {
			throw new Error('Shadow Y control did not render.');
		}
		shadowY.value = '18';
		shadowY.dispatchEvent(new Event('change', { bubbles: true }));

		const shadowBlur = screen.getByRole('spinbutton', { name: 'Shadow blur' }).query();
		if (!(shadowBlur instanceof HTMLInputElement)) {
			throw new Error('Shadow blur control did not render.');
		}
		shadowBlur.value = '24';
		shadowBlur.dispatchEvent(new Event('change', { bubbles: true }));

		const shadowColor = screen.getByLabelText('Shadow color').query();
		if (!(shadowColor instanceof HTMLInputElement)) {
			throw new Error('Shadow color control did not render.');
		}
		shadowColor.value = '#336699';
		shadowColor.dispatchEvent(new Event('change', { bubbles: true }));

		await screen.getByRole('button', { name: 'Alignment', exact: true }).click();
		await screen.getByRole('option', { name: 'Left', exact: true }).click();
		await screen.getByRole('button', { name: 'Vertical alignment', exact: true }).click();
		await screen.getByRole('option', { name: 'Bottom', exact: true }).click();
		await screen.getByRole('button', { name: 'Clear background' }).click();

		expect(timelineStore.itemById.get('text-item')).toMatchObject({
			backgroundColor: undefined,
			textAlign: 'left',
			verticalAlign: 'bottom',
			textShadow: { blur: 24, color: '#336699', offsetX: 12, offsetY: 18 }
		});
		expect(commandHistory.canUndo).toBe(true);
		expect(onedit).toHaveBeenCalledTimes(7);

		screen.container.style.width = '260px';
		const panel = screen.container.firstElementChild;
		expect(panel).not.toBeNull();
		if (panel) expect(panel.scrollWidth).toBeLessThanOrEqual(260);
	});
});
