import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import SpeechCleanupDialog from './speech-cleanup-dialog.svelte';
import type { FillerRangesByMediaId } from '../transcript/speech-cleanup';
import '../../../routes/layout.css';

const videoTrack: TimelineTrack = {
	id: 'video-track',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const captionTrack: TimelineTrack = { ...videoTrack, id: 'captions', name: 'Captions', order: 1 };

const video: TimelineItem = {
	id: 'video',
	trackId: videoTrack.id,
	from: 0,
	durationInFrames: 180,
	label: 'Interview',
	type: 'video',
	mediaId: 'media',
	sourceStart: 0,
	sourceEnd: 180,
	sourceFps: 30,
	speed: 1
};

const captions: TimelineItem = {
	id: 'captions',
	trackId: captionTrack.id,
	from: 0,
	durationInFrames: 180,
	label: 'Auto captions',
	type: 'subtitle',
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
			startFrame: 15,
			endFrame: 150,
			text: 'Well um let us begin',
			words: [
				{ id: 'well', startFrame: 15, endFrame: 25, text: 'Well' },
				{ id: 'um', startFrame: 30, endFrame: 42, text: 'um' },
				{ id: 'let', startFrame: 90, endFrame: 100, text: 'let' },
				{ id: 'us', startFrame: 102, endFrame: 110, text: 'us' },
				{ id: 'begin', startFrame: 115, endFrame: 150, text: 'begin' }
			]
		}
	]
};

async function scoreFillers(ranges: FillerRangesByMediaId): Promise<FillerRangesByMediaId> {
	return Object.fromEntries(
		Object.entries(ranges).map(([mediaId, candidates]) => [
			mediaId,
			candidates.map((candidate) => ({
				...candidate,
				audioConfidence: {
					level: 'high' as const,
					fillerScore: 0.8,
					nonFillerScore: 0.1,
					label: 'person saying um'
				}
			}))
		])
	);
}

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [videoTrack, captionTrack], items: [video, captions], fps: 30 });
});

describe('SpeechCleanupDialog', () => {
	it('reviews exact filler cuts, fits a phone, and applies once', async () => {
		await page.viewport(320, 720);
		const onapplied = vi.fn();
		const screen = await render(SpeechCleanupDialog, {
			open: true,
			itemIds: [video.id],
			initialMode: 'fillers',
			onapplied,
			scoreFillerRanges: scoreFillers
		});

		await expect.element(screen.getByRole('dialog')).toBeVisible();
		await expect.element(screen.getByText('1 cut selected')).toBeVisible();
		await expect.element(screen.getByText('um')).toBeVisible();
		await expect.element(screen.getByText('High confidence')).toBeVisible();
		expect(screen.getByRole('dialog').element().scrollWidth).toBeLessThanOrEqual(
			screen.getByRole('dialog').element().clientWidth
		);
		await screen.getByText('Words and phrases').click();
		await screen.getByLabelText('Single words, separated by commas').fill('ah, uh, um, hmm');
		await expect
			.element(screen.getByRole('button', { name: 'Remove selected fillers' }))
			.toBeDisabled();
		await expect
			.element(screen.getByText('Settings changed. Update the review before removing anything.'))
			.toBeVisible();
		await screen.getByRole('button', { name: 'Update review' }).click();
		await screen.getByRole('button', { name: 'Include um' }).click();
		await expect.element(screen.getByText('0 cuts selected')).toBeVisible();
		await screen.getByRole('button', { name: 'Include um' }).click();
		await screen.getByRole('button', { name: 'Remove selected fillers' }).click();

		expect(onapplied).toHaveBeenCalledOnce();
		expect(timelineStore.items.filter((item) => item.type === 'video')).toHaveLength(2);
		expect(commandHistory.undoStack).toHaveLength(1);
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
	});

	it('finds transcript gaps without decoding media', async () => {
		const screen = await render(SpeechCleanupDialog, {
			open: true,
			itemIds: [video.id],
			initialMode: 'silence',
			onapplied: vi.fn()
		});
		await screen.getByRole('button', { name: 'Transcript gaps' }).click();
		await expect.element(screen.getByText('2 cuts selected')).toBeVisible();
		await expect.element(screen.getByText('About 2.2s will be removed')).toBeVisible();
	});
});
