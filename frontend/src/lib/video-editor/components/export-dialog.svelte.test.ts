import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { get } from 'svelte/store';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { mediaPool } from '../media/pool.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import ExportDialog from './export-dialog.svelte';
import { renderQueueStore } from '../export/render-queue-store';
import type {
	AudioExportOptions,
	RenderExportOptions,
	RenderExportResult
} from '../media/render-export';
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
	it('shows the live render phase and cancels the immediate export', async () => {
		await page.viewport(320, 720);
		let renderSignal: AbortSignal | undefined;
		const renderVideo = vi.fn(
			async (_project: Project, options: RenderExportOptions = {}): Promise<RenderExportResult> => {
				renderSignal = options.signal;
				options.onProgress?.({
					phase: 'rendering',
					framesDone: 45,
					totalFrames: 300,
					progress: 0.15
				});
				return await new Promise((_resolve, reject) => {
					options.signal?.addEventListener(
						'abort',
						() => reject(new DOMException('Export cancelled', 'AbortError')),
						{ once: true }
					);
				});
			}
		);
		const screen = await render(ExportDialog, {
			project,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true),
			renderVideo
		});

		await screen.getByRole('button', { name: 'Render full video' }).click();
		await expect.element(screen.getByText('Ready to render')).toBeVisible();
		await screen.getByRole('button', { name: 'Render now' }).click();
		await expect.element(screen.getByText('Rendering frames')).toBeVisible();
		await expect.element(screen.getByText('Frame 45 / 300')).toBeVisible();
		await expect.element(screen.getByText('15%')).toBeVisible();
		expect(screen.getByRole('dialog').element().scrollWidth).toBeLessThanOrEqual(
			screen.getByRole('dialog').element().clientWidth
		);
		await page.viewport(390, 720);
		expect(screen.getByRole('dialog').element().scrollWidth).toBeLessThanOrEqual(
			screen.getByRole('dialog').element().clientWidth
		);

		await userEvent.click(screen.getByRole('button', { name: 'Cancel export' }).element());
		expect(renderSignal?.aborted).toBe(true);
		await expect.element(screen.getByRole('button', { name: 'Render now' })).toBeEnabled();
		expect(renderVideo).toHaveBeenCalledOnce();
	});

	it('forwards audio encoding progress to the immediate export view', async () => {
		let renderSignal: AbortSignal | undefined;
		const renderAudio = vi.fn(
			async (_project: Project, options: AudioExportOptions): Promise<RenderExportResult> => {
				renderSignal = options.signal;
				options.onProgress?.({
					phase: 'encoding',
					framesDone: 180,
					totalFrames: 300,
					progress: 0.6
				});
				return await new Promise((_resolve, reject) => {
					options.signal?.addEventListener(
						'abort',
						() => reject(new DOMException('Export cancelled', 'AbortError')),
						{ once: true }
					);
				});
			}
		);
		const screen = await render(ExportDialog, {
			project,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true),
			renderAudio
		});

		await screen.getByRole('button', { name: 'Render full video' }).click();
		await screen.getByText('WebM', { exact: true }).click();
		await screen.getByRole('option', { name: 'Audio only: MP3' }).click();
		await expect.element(screen.getByText('Ready to render')).toBeVisible();
		await screen.getByRole('button', { name: 'Render now' }).click();
		await expect.element(screen.getByText('Encoding output')).toBeVisible();
		await expect.element(screen.getByText('60%')).toBeVisible();
		await screen.getByRole('button', { name: 'Cancel export' }).click();
		expect(renderSignal?.aborted).toBe(true);
		expect(renderAudio).toHaveBeenCalledOnce();
	});

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
		await screen.getByRole('menuitem', { name: 'Add current range' }).click();
		expect(get(renderQueueStore).jobs).toHaveLength(1);
		const queuedJob = get(renderQueueStore).jobs[0];
		if (!queuedJob) throw new Error('Expected one queued render');
		expect(renderQueueStore.markRendering(queuedJob.id)).toBe(true);
		renderQueueStore.updateProgress(queuedJob.id, {
			phase: 'encoding',
			framesDone: 225,
			totalFrames: 300,
			progress: 0.75
		});
		const liveItem = timelineStore.itemById.get('video');
		if (!liveItem) throw new Error('Expected the live video item');
		liveItem.label = 'Changed later';
		expect(get(renderQueueStore).jobs[0]?.snapshot.items[0]?.label).toBe('Interview');
		await screen.getByRole('button', { name: 'Exports (1)' }).click();
		await expect.element(screen.getByText('Interview')).toBeVisible();
		await expect.element(screen.getByText('Encoding output')).toBeVisible();
		await expect.element(screen.getByText('75%')).toBeVisible();
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

	it('queues one shared frozen render snapshot per marker span', async () => {
		await page.viewport(320, 720);
		timelineStore.setAll({
			tracks: [track],
			items: [item],
			markers: [{ id: 'middle', frame: 150, label: 'Middle', color: '#d97746' }],
			fps: 30,
			currentFrame: 0
		});
		const screen = await render(ExportDialog, {
			project,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true)
		});

		await screen.getByRole('button', { name: 'Render full video' }).click();
		await expect.element(screen.getByText('Ready to render')).toBeVisible();
		await screen.getByRole('button', { name: 'Add to queue' }).click();
		await screen.getByRole('menuitem', { name: 'One segment per marker' }).click();

		const jobs = get(renderQueueStore).jobs;
		expect(jobs.map((job) => job.settings.range)).toEqual([
			{ startFrame: 0, endFrame: 150 },
			{ startFrame: 150, endFrame: 300 }
		]);
		expect(jobs[0]?.snapshot).toBe(jobs[1]?.snapshot);
		await screen.getByRole('button', { name: 'Exports (2)' }).click();
		await expect.element(screen.getByText('Interview - Part 1')).toBeVisible();
		await expect.element(screen.getByText('Interview - Part 2')).toBeVisible();
		const queueDialog = screen.getByRole('dialog').element();
		expect(queueDialog.scrollWidth).toBeLessThanOrEqual(queueDialog.clientWidth);
	});

	it('allows fixed segments when the unsplit render exceeds the memory limit', async () => {
		await page.viewport(320, 720);
		const longItem = { ...item, durationInFrames: 72_000 };
		const longProject = {
			...project,
			duration: 2_400,
			timeline: { tracks: [track], items: [longItem] }
		};
		timelineStore.setAll({
			tracks: [track],
			items: [longItem],
			fps: 30,
			currentFrame: 0
		});
		const screen = await render(ExportDialog, {
			project: longProject,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true)
		});

		await screen.getByRole('button', { name: 'Render full video' }).click();
		await expect.element(screen.getByRole('button', { name: 'Add to queue' })).toBeEnabled();
		await expect.element(screen.getByRole('button', { name: 'Render now' })).toBeDisabled();
		await screen.getByRole('button', { name: 'Add to queue' }).click();
		await screen.getByRole('menuitem', { name: 'Every 60 seconds' }).click();

		const jobs = get(renderQueueStore).jobs;
		expect(jobs).toHaveLength(40);
		expect(jobs[0]?.settings.range).toEqual({ startFrame: 0, endFrame: 1_800 });
		expect(jobs[39]?.settings.range).toEqual({ startFrame: 70_200, endFrame: 72_000 });
		expect(new Set(jobs.map((job) => job.snapshot))).toHaveLength(1);
	});
});
