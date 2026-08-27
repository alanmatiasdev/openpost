import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { AudioEqSettings } from '$lib/video-editor/audio/types';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import AudioEqPanel from './audio-eq-panel.svelte';
import '../../../routes/layout.css';

describe('AudioEqPanel', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
	});

	it('edits a track or bus EQ value without requiring a timeline clip', async () => {
		await page.viewport(320, 844);
		const settings: AudioEqSettings = {
			enabled: true,
			lowEnabled: true,
			lowGainDb: 3,
			lowFrequencyHz: 120
		};
		const onsettingschange = vi.fn();
		const screen = await render(AudioEqPanel, {
			settings,
			onsettingschange,
			title: 'Track EQ'
		});
		screen.container.style.width = '300px';
		screen.container.style.background = 'oklch(0.15 0.008 55)';

		await screen.getByText('Track EQ', { exact: true }).click();
		await screen.getByRole('button', { name: 'Bypass', exact: true }).click();
		expect(onsettingschange).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));

		await page.screenshot({
			element: screen.container,
			path: '../../../../.svelte-kit/openpost-track-audio-eq.png'
		});
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
	});

	it('keeps clip EQ edits on the existing timeline action path', async () => {
		const item: TimelineItem = {
			id: 'voice',
			trackId: 'audio',
			from: 0,
			durationInFrames: 90,
			label: 'Voice',
			type: 'audio',
			mediaId: 'voice-media',
			audioEqLowEnabled: true,
			audioEqLowGainDb: 3
		};
		timelineStore.setAll({
			fps: 30,
			tracks: [
				{
					id: 'audio',
					name: 'Audio 1',
					kind: 'audio',
					height: 72,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 0
				}
			],
			items: [item]
		});
		const onedit = vi.fn();
		const screen = await render(AudioEqPanel, { item, onedit });

		await screen.getByText('Parametric EQ', { exact: true }).click();
		await screen.getByRole('button', { name: 'Bypass', exact: true }).click();

		expect(timelineStore.itemById.get(item.id)).toMatchObject({
			audioEqEnabled: false,
			audioEqLowEnabled: true,
			audioEqLowGainDb: 3
		});
		expect(onedit).toHaveBeenCalledOnce();
	});
});
