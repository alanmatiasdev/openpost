import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { mediaPool } from '../media/pool.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import ExportDialog from './export-dialog.svelte';
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
		await expect.element(screen.getByRole('button', { name: 'Start export' })).toBeEnabled();
		const dialog = screen.getByRole('dialog').element();
		expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);

		mediaPool.setStatus('media', 'failed', 'File moved');
		await expect.element(screen.getByText('Fix these issues before exporting')).toBeVisible();
		await expect.element(screen.getByText('Relink 1 missing or unreadable sources.')).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Start export' })).toBeDisabled();
		await page.viewport(1280, 720);
	});
});
