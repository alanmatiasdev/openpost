import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { get } from 'svelte/store';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { mediaPool } from '../media/pool.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import ExportDialog from './export-dialog.svelte';
import { renderQueueStore } from '../export/render-queue-store';
import '../../../routes/layout.css';

const track: TimelineTrack = {
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

const item: TimelineItem = {
	id: 'video',
	trackId: track.id,
	from: 0,
	durationInFrames: 300,
	label: 'Interview',
	type: 'video',
	mediaId: 'media'
};

const project: Project = {
	id: 'project',
	name: 'Interview',
	description: '',
	createdAt: 0,
	updatedAt: 0,
	duration: 10,
	metadata: { width: 1920, height: 1080, fps: 30 },
	timeline: { tracks: [track], items: [item] }
};

beforeEach(() => {
	mediaPool.clear();
	renderQueueStore.hydrate([], false);
	mediaPool.upsert(
		{
			id: 'media',
			storageType: 'workspace',
			fileName: 'interview.mp4',
			fileSize: 100,
			mimeType: 'video/mp4',
			duration: 10,
			width: 1920,
			height: 1080,
			fps: 30,
			codec: 'avc',
			bitrate: 1,
			tags: ['video']
		},
		'ready'
	);
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [item], fps: 30, currentFrame: 0 });
});

describe('ExportDialog', () => {
	it('shows live readiness, blocks missing sources, and fits a phone-width viewport', async () => {
		await page.viewport(320, 720);
		const screen = await render(ExportDialog, {
			project,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true)
		});

		await screen.getByRole('button', { name: 'Render full video' }).click();
		await expect.element(screen.getByText('Ready to render')).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Render now' })).toBeEnabled();
		const dialog = screen.getByRole('dialog').element();
		expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
		await screen.getByRole('button', { name: 'Add to queue' }).click();
		expect(get(renderQueueStore).jobs).toHaveLength(1);
		const liveItem = timelineStore.itemById.get('video');
		if (!liveItem) throw new Error('Expected the live video item');
		liveItem.label = 'Changed later';
		expect(get(renderQueueStore).jobs[0]?.snapshot.items[0]?.label).toBe('Interview');
		await screen.getByRole('button', { name: 'Render queue (1)' }).click();
		await expect.element(screen.getByText('Interview')).toBeVisible();
		const queueDialog = screen.getByRole('dialog').element();
		expect(queueDialog.scrollWidth).toBeLessThanOrEqual(queueDialog.clientWidth);
		await page.viewport(1280, 720);
		expect(queueDialog.scrollWidth).toBeLessThanOrEqual(queueDialog.clientWidth);
		await userEvent.keyboard('{Escape}');
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();

		mediaPool.setStatus('media', 'failed', 'File moved');
		await screen.getByRole('button', { name: 'Render full video' }).click();
		await expect.element(screen.getByText('Fix these issues before exporting')).toBeVisible();
		await expect.element(screen.getByText('Relink 1 missing or unreadable sources.')).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Render now' })).toBeDisabled();
	});
});
