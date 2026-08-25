import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { editorSession } from '../editor.svelte';
import { mediaPool } from '../media/pool.svelte';
import { mediaRecovery } from '../media/media-recovery.svelte';
import type { MediaMetadata } from '../media/types';
import { createEmptyTimeline } from '../project/defaults';
import type { SubComposition, TimelineItem, TimelineTrack } from '../project/types';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import MediaPoolList from './media-pool-list.svelte';
import '../../../routes/layout.css';

function media(
	id: string,
	fileName: string,
	tags: string[],
	options: Partial<MediaMetadata> = {}
): MediaMetadata {
	return {
		id,
		storageType: 'workspace',
		fileName,
		fileSize: 12 * 1024 * 1024,
		mimeType: tags.includes('audio') ? 'audio/wav' : 'video/mp4',
		duration: 65,
		width: 1920,
		height: 1080,
		fps: 29.97,
		codec: 'avc',
		bitrate: 8_000_000,
		tags,
		...options
	};
}

beforeEach(() => {
	commandHistory.clearHistory();
	mediaPool.clear();
	mediaRecovery.reset();
	sequenceStore.reset();
	editorSession.project = null;
});

describe('MediaPoolList', () => {
	it('adds ready media to the matching unlocked timeline track', async () => {
		const timeline = createEmptyTimeline();
		sequenceStore.load(timeline, { width: 1920, height: 1080, fps: 30 });
		mediaPool.loadAll([media('video', 'Interview.mp4', ['video'], { duration: 2.7 })]);

		const screen = await render(MediaPoolList, { projectId: 'project' });
		await screen.getByRole('button', { name: 'Add to timeline: Interview.mp4' }).click();

		const inserted = sequenceStore.projectTimeline().items;
		expect(inserted).toHaveLength(1);
		expect(inserted[0]).toMatchObject({
			trackId: 'track-video-main',
			type: 'video',
			mediaId: 'video',
			durationInFrames: 81
		});
	});

	it('keeps high-cost video tools in one clear menu with honest size gates', async () => {
		await page.viewport(320, 720);
		mediaPool.loadAll([
			media('hd', 'Interview.mp4', ['video']),
			media('four-k', 'Master 4K.mp4', ['video'], { width: 3840, height: 2160 })
		]);
		const screen = await render(MediaPoolList, { projectId: 'project' });
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);

		await screen.getByRole('button', { name: 'More actions for Interview.mp4' }).click();
		const upscale = screen.getByRole('menuitem', { name: 'Upscale 2x' });
		await expect.element(upscale).toBeEnabled();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Increase frame rate' }))
			.toBeEnabled();
		await upscale.click();
		await expect.element(screen.getByRole('menuitem', { name: 'Live action' })).toBeVisible();
		await expect.element(screen.getByRole('menuitem', { name: 'Animation' })).toBeVisible();
		await expect.element(screen.getByRole('menuitem', { name: '3D render' })).toBeVisible();

		document.body.click();
		await screen.getByRole('button', { name: 'More actions for Master 4K.mp4' }).click();
		await expect
			.element(
				screen.getByRole('menuitem', {
					name: 'Upscale 2x unavailable: the result would exceed the safe browser limit'
				})
			)
			.toBeDisabled();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Increase frame rate' }))
			.toBeEnabled();
	});

	it('shows rendered sequence thumbnails and keeps duplicate and delete actions safe', async () => {
		await page.viewport(320, 720);
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
		const shape: TimelineItem = {
			id: 'shape',
			trackId: track.id,
			from: 0,
			durationInFrames: 60,
			label: 'Card',
			type: 'shape',
			shapeType: 'rectangle',
			fillColor: '#ff0000',
			fillEnabled: true,
			transform: { width: 200, height: 100 }
		};
		const sequence: SubComposition = {
			id: 'scene',
			name: 'Scene',
			items: [shape],
			tracks: [track],
			transitions: [],
			fps: 30,
			width: 200,
			height: 100,
			durationInFrames: 60
		};
		sequenceStore.load(
			{
				...createEmptyTimeline(),
				tracks: [track],
				items: [
					{
						id: 'scene-reference',
						trackId: track.id,
						from: 0,
						durationInFrames: 60,
						label: sequence.name,
						type: 'composition',
						compositionId: sequence.id
					}
				],
				compositions: [sequence],
				topLevelSequenceIds: [sequence.id]
			},
			{ width: 200, height: 100, fps: 30 }
		);

		const screen = await render(MediaPoolList, { projectId: 'project' });
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
		await vi.waitFor(() => {
			expect(screen.container.querySelector('img[src^="blob:"]')).not.toBeNull();
		});
		await screen.getByRole('button', { name: 'Sequence options: Scene' }).click();
		await screen.getByRole('menuitem', { name: 'Duplicate' }).click();
		await expect.element(screen.getByText('Scene copy')).toBeVisible();
		expect(sequenceStore.compositions).toHaveLength(2);

		await screen.getByRole('button', { name: 'Sequence options: Scene', exact: true }).click();
		await screen.getByRole('menuitem', { name: 'Delete' }).click();
		const dialog = screen.getByRole('dialog');
		await expect.element(dialog.getByText(/removes 1 timeline reference/)).toBeVisible();
		await dialog.getByRole('button', { name: 'Delete' }).click();
		await expect.element(dialog).not.toBeInTheDocument();
		expect(sequenceStore.compositionById.has(sequence.id)).toBe(false);
		expect(sequenceStore.projectTimeline().items).toHaveLength(0);
		expect(sequenceStore.compositions).toHaveLength(1);
	});

	it('filters, groups, explains media facts, and fits its URL flow on a phone', async () => {
		await page.viewport(320, 720);
		mediaPool.loadAll([
			media('video', 'B-roll 10.mp4', ['video']),
			media('audio', 'Voice.wav', ['audio'], {
				width: 0,
				height: 0,
				fps: 0,
				codec: '',
				audioCodec: 'pcm_s16le'
			}),
			media('image', 'Poster.svg', ['image'], {
				mimeType: 'image/svg+xml',
				duration: 0,
				width: 1200,
				height: 630,
				fps: 0,
				codec: ''
			})
		]);

		const screen = await render(MediaPoolList, {
			projectId: 'project',
			onsequenceopen: vi.fn(),
			onsourceopen: vi.fn()
		});
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
		await expect.element(screen.getByRole('heading', { name: 'Video 1' })).toBeVisible();
		await expect.element(screen.getByRole('heading', { name: 'Audio 1' })).toBeVisible();
		await expect.element(screen.getByRole('heading', { name: 'Images 1' })).toBeVisible();
		await expect.element(screen.getByText('1200 × 630')).toBeVisible();

		await screen.getByRole('button', { name: 'Filter media' }).click();
		await screen.getByRole('option', { name: 'Audio' }).click();
		await expect.element(screen.getByText('Voice.wav')).toBeVisible();
		await expect.element(screen.getByText('B-roll 10.mp4')).not.toBeInTheDocument();

		await screen.getByRole('button', { name: 'Filter media' }).click();
		await screen.getByRole('option', { name: 'All media' }).click();
		await screen.getByPlaceholder('Search project media').fill('B-roll');
		await screen.getByRole('button', { name: 'Media info: B-roll 10.mp4' }).click();
		await expect.element(screen.getByText('1920 × 1080')).toBeVisible();
		await expect.element(screen.getByText('29.97 fps')).toBeVisible();
		await expect.element(screen.getByText('8 Mbps')).toBeVisible();
		await expect.element(screen.getByText('Copied into this workspace')).toBeVisible();

		await screen.getByRole('button', { name: 'Import from URL' }).click();
		const dialog = screen.getByRole('dialog');
		await expect.element(dialog).toBeVisible();
		expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);
		await expect.element(screen.getByLabelText('Direct media URL')).toBeVisible();
		await expect
			.element(screen.getByText(/Web pages and signed-in downloads are not supported/))
			.toBeVisible();
	});
});
