import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { transcriptIgnoreStore } from '../transcript/transcript-ignore-store.svelte';
import TranscriptPanel from './transcript-panel.svelte';
import '../../../routes/layout.css';

const track: TimelineTrack = {
	id: 'captions',
	name: 'Captions',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const item: TimelineItem = {
	id: 'subtitle',
	trackId: track.id,
	from: 0,
	durationInFrames: 90,
	label: 'Captions',
	type: 'subtitle',
	cues: [
		{
			id: 'cue',
			startFrame: 0,
			endFrame: 90,
			text: '{\\an8}<b>Ready</b>',
			words: [{ id: 'word', startFrame: 0, endFrame: 30, text: 'Ready' }]
		}
	]
};

beforeEach(() => {
	commandHistory.clearHistory();
	transcriptIgnoreStore.__resetForTesting();
	timelineStore.__resetForTesting();
	timelineStore.setAll({
		tracks: [track],
		items: [item],
		currentFrame: 0,
		fps: 30
	});
});

describe('TranscriptPanel cue formatting', () => {
	it('hides markup and preserves cue-wide formatting through copy and word edits', async () => {
		const onedit = vi.fn();
		const screen = await render(TranscriptPanel, { onedit });
		const cueInput = screen.getByLabelText('Caption line');
		await expect.element(cueInput).toHaveValue('Ready');

		await screen.getByRole('button', { name: 'Italic', exact: true }).click();
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.text).toBe(
			'{\\an8}<b><i>Ready</i></b>'
		);

		await cueInput.fill('Ship it');
		cueInput.element().dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.text).toBe(
			'{\\an8}<b><i>Ship it</i></b>'
		);

		const wordInput = screen.getByRole('textbox', {
			name: 'Transcript word',
			exact: true
		});
		await wordInput.fill('Shipped');
		wordInput.element().dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.text).toBe(
			'{\\an8}<b><i>Shipped</i></b>'
		);
		expect(commandHistory.undoStack).toHaveLength(3);
		expect(onedit).toHaveBeenCalledTimes(3);

		screen.container.style.width = '320px';
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(320);
	});

	it('stages transcript words for review, then ripple deletes them in one undo step', async () => {
		await page.viewport(320, 720);
		const videoTrack: TimelineTrack = { ...track, id: 'video', name: 'Video', order: 1 };
		const video: TimelineItem = {
			id: 'video',
			trackId: videoTrack.id,
			from: 0,
			durationInFrames: 90,
			label: 'Interview',
			type: 'video',
			mediaId: 'media',
			sourceStart: 0,
			sourceEnd: 90,
			sourceFps: 30,
			speed: 1
		};
		const timedCaptions: TimelineItem = {
			...item,
			captionSource: {
				type: 'transcript',
				clipId: video.id,
				mediaId: 'media',
				sourceStartSeconds: 0,
				playbackSpeed: 1
			},
			cues: [
				{
					id: 'cue',
					startFrame: 0,
					endFrame: 90,
					text: '<b>Please um continue</b>',
					words: [
						{ id: 'please', startFrame: 0, endFrame: 25, text: 'Please' },
						{ id: 'um', startFrame: 30, endFrame: 45, text: 'um' },
						{ id: 'continue', startFrame: 50, endFrame: 90, text: 'continue' }
					]
				}
			]
		};
		timelineStore.setAll({
			tracks: [track, videoTrack],
			items: [video, timedCaptions],
			currentFrame: 0,
			fps: 30
		});
		commandHistory.clearHistory();
		const onedit = vi.fn();
		const screen = await render(TranscriptPanel, { onedit });

		await screen.getByRole('button', { name: 'Edit video by transcript' }).click();
		await screen.getByRole('button', { name: 'Select "um"' }).click();
		await expect.element(screen.getByText('Words selected: 1')).toBeVisible();
		await screen.getByRole('button', { name: 'Stage words' }).click();
		await expect.element(screen.getByText('1 staged · 0.5s')).toBeVisible();
		expect(screen.container.querySelector('[data-ignored="true"]')).not.toBeNull();
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(320);
		expect(timelineStore.items.filter((candidate) => candidate.type === 'video')).toHaveLength(1);
		expect(commandHistory.undoStack).toHaveLength(0);

		await screen.getByRole('button', { name: 'Cut staged words' }).click();

		expect(timelineStore.items.filter((candidate) => candidate.type === 'video')).toHaveLength(2);
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.text).toBe('<b>Please continue</b>');
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.words).toMatchObject([
			{ id: 'please', startFrame: 0, endFrame: 25 },
			{ id: 'continue', startFrame: 35, endFrame: 75 }
		]);
		expect(timelineStore.itemById.get('subtitle')?.durationInFrames).toBe(75);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
		expect(transcriptIgnoreStore.spanCount).toBe(0);
		commandHistory.undo();
		expect(timelineStore.items.filter((candidate) => candidate.type === 'video')).toHaveLength(1);
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.text).toBe(
			'<b>Please um continue</b>'
		);
	});
});
