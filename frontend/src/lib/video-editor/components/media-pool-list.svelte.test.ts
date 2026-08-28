import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { editorSession } from '../editor.svelte';
import { mediaPool } from '../media/pool.svelte';
import { mediaRecovery } from '../media/media-recovery.svelte';
import { mediaPlacement } from '../media/media-placement.svelte';
import { parseMediaDragData, VIDEO_EDITOR_MEDIA_DRAG_MIME } from '../media/media-drag';
import type { MediaMetadata } from '../media/types';
import { createEmptyTimeline } from '../project/defaults';
import type { SubComposition, TimelineItem, TimelineTrack } from '../project/types';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { sceneBrowser } from '../media/scene-search/scene-browser.svelte';
import { cachedProxy, clearProxyCache } from '../media/proxy-client';
import { mediaTaskId, mediaTasks } from '../media/media-tasks.svelte';
import {
	sourceTranscriptionTaskId,
	transcriptionService
} from '../transcript/transcription-service.svelte';
import { editorSettings } from '../settings/editor-settings.svelte';
import proResFixtureUrl from '../media/fixtures/prores-proxy.mov?url';
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

function linkedFileHandle(name: string, file: File): FileSystemFileHandle {
	const handle: FileSystemFileHandle = {
		kind: 'file',
		name,
		getFile: async () => file,
		async createWritable() {
			throw new Error('This read-only test handle cannot write.');
		},
		async createSyncAccessHandle() {
			throw new Error('This read-only test handle cannot open synchronous access.');
		},
		async isSameEntry(other) {
			return other === handle;
		}
	};
	return handle;
}

beforeEach(() => {
	commandHistory.clearHistory();
	mediaPool.clear();
	mediaRecovery.reset();
	mediaPlacement.cancel();
	mediaTasks.reset();
	transcriptionService.reset();
	editorSettings.reset();
	sceneBrowser.reset();
	sequenceStore.reset();
	editorSession.project = null;
});

afterEach(() => {
	vi.restoreAllMocks();
	clearProxyCache('proxy-video');
	mediaTasks.reset();
	sceneBrowser.reset();
});

describe('MediaPoolList', () => {
	it('starts exact keyboard and touch placement for ready media', async () => {
		const timeline = createEmptyTimeline();
		sequenceStore.load(timeline, { width: 1920, height: 1080, fps: 30 });
		mediaPool.loadAll([media('video', 'Interview.mp4', ['video'], { duration: 2.7 })]);

		const screen = await render(MediaPoolList, { projectId: 'project' });
		const row = screen.getByText('Interview.mp4').element().closest('li');
		expect(row).not.toBeNull();
		const dataTransfer = new DataTransfer();
		row!.dispatchEvent(
			new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer })
		);
		expect([...dataTransfer.types]).toContain(VIDEO_EDITOR_MEDIA_DRAG_MIME);
		expect(parseMediaDragData(dataTransfer.getData(VIDEO_EDITOR_MEDIA_DRAG_MIME))).toMatchObject({
			source: 'media',
			id: 'video'
		});
		await screen.getByRole('button', { name: 'Place on timeline: Interview.mp4' }).click();

		expect(sequenceStore.projectTimeline().items).toHaveLength(0);
		expect(mediaPlacement.request?.payload).toMatchObject({
			version: 1,
			source: 'media',
			id: 'video',
			label: 'Interview.mp4'
		});
	});

	it('offers source and placement actions from a media row context menu', async () => {
		mediaPool.loadAll([media('video', 'Interview.mp4', ['video'])]);
		const onsourceopen = vi.fn();
		const screen = await render(MediaPoolList, {
			projectId: 'project',
			onsourceopen
		});
		const row = screen.getByText('Interview.mp4').element().closest('li');
		expect(row).not.toBeNull();

		row!.dispatchEvent(
			new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true,
				clientX: 80,
				clientY: 80
			})
		);

		await expect.element(screen.getByRole('menuitem', { name: 'Source' })).toBeVisible();
		await screen.getByRole('menuitem', { name: 'Place on timeline' }).click();
		expect(mediaPlacement.request?.payload).toMatchObject({
			source: 'media',
			id: 'video'
		});
		expect(onsourceopen).not.toHaveBeenCalled();
	});

	it('selects visible media ranges without opening modifier-clicked sources', async () => {
		await page.viewport(320, 720);
		const interview = media('interview', 'Interview.mp4', ['video']);
		const broll = media('broll', 'B-roll.mp4', ['video']);
		const music = media('music', 'Theme.wav', ['audio']);
		mediaPool.loadAll([interview, broll, music]);
		const onsourceopen = vi.fn();
		const screen = await render(MediaPoolList, { projectId: 'project', onsourceopen });
		const source = (name: string) => screen.getByRole('button', { name: `Source: ${name}` });

		await source(interview.fileName).click();
		expect(onsourceopen).toHaveBeenCalledExactlyOnceWith(interview.id);
		await expect.element(source(interview.fileName)).toHaveAttribute('aria-pressed', 'true');

		await source(broll.fileName).click({ modifiers: ['Meta'] });
		expect(onsourceopen).toHaveBeenCalledTimes(1);
		await expect.element(screen.getByText('2 selected')).toBeVisible();

		await source(music.fileName).click({ modifiers: ['Shift'] });
		expect(onsourceopen).toHaveBeenCalledTimes(1);
		await expect.element(screen.getByText('3 selected')).toBeVisible();
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
		await screen.getByRole('button', { name: 'Filter media' }).click();
		await screen.getByRole('option', { name: 'Audio' }).click();
		await expect.element(screen.getByText('1 selected')).toBeVisible();

		await screen.getByRole('button', { name: 'Clear selection' }).click();
		await expect.element(screen.getByText('1 selected')).not.toBeInTheDocument();
	});

	it('runs proxy and delete actions for the preserved media selection', async () => {
		await page.viewport(320, 720);
		const interview = media('interview', 'Interview.mp4', ['video']);
		const broll = media('broll', 'B-roll.mp4', ['video']);
		const music = media('music', 'Theme.wav', ['audio']);
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
		sequenceStore.load(
			{
				...createEmptyTimeline(),
				tracks: [track],
				items: [interview, broll].map<TimelineItem>((source, index) => ({
					id: `clip-${source.id}`,
					trackId: track.id,
					from: index * 60,
					durationInFrames: 60,
					label: source.fileName,
					type: 'video',
					mediaId: source.id
				}))
			},
			{ width: 1920, height: 1080, fps: 30 }
		);
		mediaPool.loadAll([interview, broll, music]);
		const saveNow = vi.spyOn(editorSession, 'saveNow').mockResolvedValue();
		const generateMediaProxy = vi.fn(async () => new Blob(['proxy'], { type: 'video/webm' }));
		const deleteProjectMedia = vi.fn(async () => ({
			deletedWorkspaceBytes: true,
			remainingProjectIds: []
		}));
		const screen = await render(MediaPoolList, {
			projectId: 'project',
			generateMediaProxy,
			deleteProjectMedia
		});
		const source = (name: string) => screen.getByRole('button', { name: `Source: ${name}` });

		await source(interview.fileName).click();
		await source(broll.fileName).click({ modifiers: ['Meta'] });
		const brollRow = screen.getByText(broll.fileName).element().closest('li')!;
		brollRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await expect.element(screen.getByText('2 selected')).toBeVisible();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await expect.element(screen.getByRole('menu')).not.toBeInTheDocument();

		await screen.getByRole('button', { name: 'Generate proxies for 2 selected media' }).click();
		expect(generateMediaProxy).toHaveBeenCalledTimes(2);
		expect(generateMediaProxy).toHaveBeenNthCalledWith(1, interview);
		expect(generateMediaProxy).toHaveBeenNthCalledWith(2, broll);

		await screen.getByRole('button', { name: 'Delete 2 selected media' }).click();
		const dialog = screen.getByRole('dialog');
		await expect.element(dialog.getByText('Delete 2 media sources?')).toBeVisible();
		await dialog.getByRole('button', { name: 'Delete' }).click();

		expect(deleteProjectMedia).toHaveBeenCalledTimes(2);
		expect(deleteProjectMedia).toHaveBeenNthCalledWith(1, 'project', interview.id);
		expect(deleteProjectMedia).toHaveBeenNthCalledWith(2, 'project', broll.id);
		expect(saveNow).toHaveBeenCalledTimes(1);
		expect(sequenceStore.projectTimeline().items).toEqual([]);
		expect(mediaPool.mediaList.map((item) => item.id)).toEqual([music.id]);
		await expect.element(screen.getByText('2 selected')).not.toBeInTheDocument();
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
	});

	it('keeps failed batch deletions selected after saving the combined timeline edit', async () => {
		await page.viewport(320, 720);
		const interview = media('interview', 'Interview.mp4', ['video']);
		const broll = media('broll', 'B-roll.mp4', ['video']);
		mediaPool.loadAll([interview, broll]);
		const saveNow = vi.spyOn(editorSession, 'saveNow').mockResolvedValue();
		const deleteProjectMedia = vi.fn(async (_projectId: string, mediaId: string) => {
			if (mediaId === broll.id) throw new Error('Workspace file is busy');
			return { deletedWorkspaceBytes: true, remainingProjectIds: [] };
		});
		const screen = await render(MediaPoolList, { projectId: 'project', deleteProjectMedia });
		const source = (name: string) => screen.getByRole('button', { name: `Source: ${name}` });

		await source(interview.fileName).click();
		await source(broll.fileName).click({ modifiers: ['Meta'] });
		await screen.getByRole('button', { name: 'Delete 2 selected media' }).click();
		const dialog = screen.getByRole('dialog');
		await dialog.getByRole('button', { name: 'Delete' }).click();

		expect(saveNow).toHaveBeenCalledTimes(1);
		expect(deleteProjectMedia).toHaveBeenCalledTimes(2);
		expect(mediaPool.mediaList.map((item) => item.id)).toEqual([broll.id]);
		await expect.element(screen.getByText('1 selected')).toBeVisible();
		await expect
			.element(
				dialog.getByText(
					'Deleted 1. Could not delete 1; their timeline references were already removed.'
				)
			)
			.toBeVisible();
	});

	it('repairs the exact broken media row from right-click and overflow menus', async () => {
		await page.viewport(320, 720);
		const interview = media('video', 'Interview.mp4', ['video'], {
			storageType: 'handle'
		});
		mediaPool.loadAll([interview]);
		mediaRecovery.sourceIssues = [
			{ mediaId: interview.id, fileName: interview.fileName, kind: 'permission' }
		];
		const replacementHandle = linkedFileHandle(
			'Restored.mp4',
			new File(['restored'], 'Restored.mp4', { type: 'video/mp4' })
		);
		const requestSourceAccess = vi.fn(async () => true);
		const pickSourceHandle = vi
			.fn<() => Promise<FileSystemFileHandle | undefined>>()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(replacementHandle);
		const relinkSourceMedia = vi.fn(async () => ({
			...interview,
			fileName: 'Restored.mp4'
		}));
		const refresh = vi.spyOn(mediaRecovery, 'refresh').mockImplementation(async () => {
			mediaRecovery.sourceIssues = [];
		});
		const screen = await render(MediaPoolList, {
			projectId: 'project',
			requestSourceAccess,
			pickSourceHandle,
			relinkSourceMedia
		});
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
		const row = screen.getByText(interview.fileName).element().closest('li')!;
		await expect.element(screen.getByText('Access expired')).toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: `Place on timeline: ${interview.fileName}` }))
			.toBeDisabled();

		row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await screen.getByRole('menuitem', { name: 'Locate file' }).click();
		expect(pickSourceHandle).toHaveBeenCalledTimes(1);
		expect(relinkSourceMedia).not.toHaveBeenCalled();

		row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await screen.getByRole('menuitem', { name: 'Grant access' }).click();
		expect(requestSourceAccess).toHaveBeenCalledExactlyOnceWith(interview);
		expect(refresh).toHaveBeenCalledTimes(1);

		mediaRecovery.sourceIssues = [
			{ mediaId: interview.id, fileName: interview.fileName, kind: 'changed' }
		];
		await tick();
		await screen.getByRole('button', { name: `More actions for ${interview.fileName}` }).click();
		await screen.getByRole('menuitem', { name: 'Locate file' }).first().click();
		expect(relinkSourceMedia).toHaveBeenCalledExactlyOnceWith(interview, replacementHandle);
		expect(refresh).toHaveBeenCalledTimes(2);
	});

	it('routes embedded subtitle extraction through the shared picker owner', async () => {
		const interview = media('video', 'Interview.mkv', ['video'], {
			mimeType: 'video/x-matroska'
		});
		mediaPool.loadAll([interview]);
		const onextractsubtitles = vi.fn();
		const screen = await render(MediaPoolList, {
			projectId: 'project',
			onextractsubtitles
		});
		const row = screen.getByText(interview.fileName).element().closest('li');
		expect(row).not.toBeNull();

		row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await screen.getByRole('menuitem', { name: 'Extract embedded subtitles' }).click();

		expect(onextractsubtitles).toHaveBeenCalledExactlyOnceWith(interview);
	});

	it('manages one reusable source transcript from right-click and overflow menus', async () => {
		await page.viewport(320, 720);
		const interview = media('video', 'Interview.mp4', ['video']);
		mediaPool.loadAll([interview]);
		let status: 'idle' | 'ready' = 'idle';
		vi.spyOn(transcriptionService, 'hydrateSourceTranscript').mockResolvedValue(null);
		vi.spyOn(transcriptionService, 'sourceTranscriptStatus').mockImplementation(() => status);
		const enqueue = vi.spyOn(transcriptionService, 'enqueueMedia').mockImplementation(async () => {
			status = 'ready';
			return {
				schemaVersion: 1,
				mediaId: interview.id,
				sourceFileSize: interview.fileSize,
				model: 'parakeet-tdt-v3',
				resolvedModel: 'parakeet-tdt-v3',
				quantization: 'hybrid',
				words: [{ text: 'Hello', startSeconds: 0, endSeconds: 1 }],
				createdAt: 1,
				updatedAt: 1
			};
		});
		const remove = vi
			.spyOn(transcriptionService, 'deleteMediaTranscript')
			.mockImplementation(async () => {
				status = 'idle';
			});
		const screen = await render(MediaPoolList, { projectId: 'project' });
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
		const row = screen.getByText(interview.fileName).element().closest('li')!;

		row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await screen.getByRole('menuitem', { name: 'Generate transcript' }).click();
		expect(enqueue).toHaveBeenCalledExactlyOnceWith(interview.id, {
			model: 'parakeet-tdt-v3',
			language: undefined,
			quantization: 'hybrid'
		});

		await screen.getByRole('button', { name: `More actions for ${interview.fileName}` }).click();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Refresh transcript' }))
			.toBeVisible();
		await screen.getByRole('menuitem', { name: 'Delete transcript' }).click();
		expect(remove).toHaveBeenCalledExactlyOnceWith(interview.id);
	});

	it('cancels source transcription from the same media row', async () => {
		const interview = media('video', 'Interview.mp4', ['video']);
		mediaPool.loadAll([interview]);
		vi.spyOn(transcriptionService, 'hydrateSourceTranscript').mockResolvedValue(null);
		vi.spyOn(transcriptionService, 'sourceTranscriptStatus').mockReturnValue('idle');
		const cancel = vi.spyOn(transcriptionService, 'cancelForMedia').mockReturnValue(true);
		mediaTasks.start({
			id: sourceTranscriptionTaskId(interview.id),
			kind: 'transcription',
			mediaId: interview.id,
			label: interview.fileName,
			status: 'running',
			progress: 0.5,
			onCancel: () => undefined
		});
		const screen = await render(MediaPoolList, { projectId: 'project' });
		const row = screen.getByText(interview.fileName).element().closest('li')!;

		row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await screen.getByRole('menuitem', { name: 'Cancel transcription' }).click();
		expect(cancel).toHaveBeenCalledExactlyOnceWith(interview.id);
	});

	it('generates and removes a real ProRes proxy from the exact media row', async () => {
		const response = await fetch(proResFixtureUrl);
		expect(response.ok).toBe(true);
		const source = await response.blob();
		const file = new File([source], 'Interview.mov', { type: 'video/quicktime' });
		const interview = media('proxy-video', file.name, ['video'], {
			storageType: 'handle',
			fileHandle: linkedFileHandle(file.name, file),
			fileSize: file.size,
			mimeType: file.type,
			duration: 0.125,
			width: 64,
			height: 36,
			fps: 24,
			codec: 'prores',
			bitrate: 90_000,
			videoCodecSupported: false
		});
		mediaPool.loadAll([interview]);
		const screen = await render(MediaPoolList, { projectId: 'project' });
		const row = screen.getByText(interview.fileName).element().closest('li')!;

		row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await screen.getByRole('menuitem', { name: 'Generate proxy' }).click();
		await vi.waitFor(() => expect(cachedProxy(interview.id)?.size).toBeGreaterThan(0));
		expect(cachedProxy(interview.id)?.type).toBe('video/webm');

		await screen.getByRole('button', { name: `More actions for ${interview.fileName}` }).click();
		await screen.getByRole('menuitem', { name: 'Remove proxy' }).click();
		expect(cachedProxy(interview.id)).toBeNull();
	});

	it('cancels proxy work from the same media row', async () => {
		const interview = media('video', 'Interview.mp4', ['video']);
		mediaPool.loadAll([interview]);
		const cancel = vi.fn();
		mediaTasks.start({
			id: mediaTaskId('proxy', interview.id),
			kind: 'proxy',
			mediaId: interview.id,
			label: interview.fileName,
			status: 'running',
			progress: 0.5,
			onCancel: cancel
		});
		const screen = await render(MediaPoolList, { projectId: 'project' });
		const row = screen.getByText(interview.fileName).element().closest('li')!;

		row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await screen.getByRole('menuitem', { name: 'Cancel proxy' }).click();

		expect(cancel).toHaveBeenCalledOnce();
		expect(mediaTasks.get(mediaTaskId('proxy', interview.id))?.status).toBe('cancelling');
	});

	it('analyzes and refreshes one media row without touching unrelated media', async () => {
		const interview = media('video', 'Interview.mp4', ['video']);
		const broll = media('broll', 'B-roll.mp4', ['video']);
		mediaPool.loadAll([interview, broll]);
		const analysis = {
			schemaVersion: 1 as const,
			detectorVersion: 1,
			mediaId: interview.id,
			sourceFileSize: interview.fileSize,
			method: 'histogram' as const,
			sampleIntervalSec: 0.25,
			analyzedAt: Date.now(),
			scenes: [
				{
					id: `${interview.id}:0`,
					mediaId: interview.id,
					index: 0,
					startSec: 0,
					endSec: 2,
					timeSec: 1,
					text: 'Speaker at a desk'
				}
			]
		};
		const analyze = vi.spyOn(sceneBrowser, 'analyze').mockImplementation(async (_media, force) => {
			expect(_media.id).toBe(interview.id);
			sceneBrowser.__setAnalysisForTesting(analysis);
			return { ...analysis, analyzedAt: force ? analysis.analyzedAt + 1 : analysis.analyzedAt };
		});
		const screen = await render(MediaPoolList, { projectId: 'project' });
		const row = screen.getByText(interview.fileName).element().closest('li');
		expect(row).not.toBeNull();

		row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await screen.getByRole('menuitem', { name: 'Analyze with AI' }).click();
		expect(analyze).toHaveBeenLastCalledWith(interview, false);

		row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await screen.getByRole('menuitem', { name: 'Reanalyze with AI' }).click();
		expect(analyze).toHaveBeenLastCalledWith(interview, true);
		expect(analyze).toHaveBeenCalledTimes(2);
	});

	it('cancels the active AI analysis from the same media row', async () => {
		const interview = media('video', 'Interview.mp4', ['video']);
		mediaPool.loadAll([interview]);
		vi.spyOn(sceneBrowser, 'progress').mockReturnValue({
			stage: 'captioning',
			percent: 40,
			completed: 2,
			total: 5
		});
		const cancel = vi.spyOn(sceneBrowser, 'cancel').mockImplementation(() => undefined);
		const screen = await render(MediaPoolList, { projectId: 'project' });
		const row = screen.getByText(interview.fileName).element().closest('li');
		expect(row).not.toBeNull();

		row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await screen.getByRole('menuitem', { name: 'Cancel AI analysis' }).click();
		expect(cancel).toHaveBeenCalledExactlyOnceWith(interview.id);
	});

	it('confirms affected references and safely deletes one project media item', async () => {
		const interview = media('video', 'Interview.mp4', ['video']);
		const track: TimelineTrack = {
			id: 'visual',
			name: 'Visual',
			kind: 'video',
			height: 64,
			locked: true,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const source: TimelineItem = {
			id: 'source',
			trackId: track.id,
			from: 0,
			durationInFrames: 60,
			label: 'Interview',
			type: 'video',
			mediaId: interview.id
		};
		const caption: TimelineItem = {
			id: 'caption',
			trackId: track.id,
			from: 0,
			durationInFrames: 60,
			label: 'Interview captions',
			type: 'subtitle',
			captionSource: {
				type: 'transcript',
				clipId: source.id,
				mediaId: interview.id
			}
		};
		sequenceStore.load(
			{ ...createEmptyTimeline(), tracks: [track], items: [source, caption] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		mediaPool.loadAll([interview]);
		const deleteProjectMedia = vi.fn(async () => ({
			deletedWorkspaceBytes: true,
			remainingProjectIds: []
		}));
		const screen = await render(MediaPoolList, {
			projectId: 'project',
			deleteProjectMedia
		});
		const row = screen.getByText(interview.fileName).element().closest('li');
		expect(row).not.toBeNull();

		row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await screen.getByRole('menuitem', { name: 'Delete' }).click();
		const dialog = screen.getByRole('dialog');
		await expect
			.element(dialog.getByText(/removes 2 timeline clips and generated captions/))
			.toBeVisible();
		await dialog.getByRole('button', { name: 'Delete' }).click();

		await expect.element(dialog).not.toBeInTheDocument();
		expect(deleteProjectMedia).toHaveBeenCalledExactlyOnceWith('project', interview.id);
		expect(sequenceStore.projectTimeline().items).toEqual([]);
		expect(mediaPool.get(interview.id)).toBeUndefined();
	});

	it('restores timeline references and keeps media when the durable save fails', async () => {
		const interview = media('video', 'Interview.mp4', ['video']);
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
		const source: TimelineItem = {
			id: 'source',
			trackId: track.id,
			from: 0,
			durationInFrames: 60,
			label: 'Interview',
			type: 'video',
			mediaId: interview.id
		};
		sequenceStore.load(
			{ ...createEmptyTimeline(), tracks: [track], items: [source] },
			{ width: 1920, height: 1080, fps: 30 }
		);
		mediaPool.loadAll([interview]);
		vi.spyOn(editorSession, 'saveNow').mockRejectedValue(new Error('Workspace write failed'));
		const deleteProjectMedia = vi.fn(async () => ({
			deletedWorkspaceBytes: true,
			remainingProjectIds: []
		}));
		const screen = await render(MediaPoolList, {
			projectId: 'project',
			deleteProjectMedia
		});
		const row = screen.getByText(interview.fileName).element().closest('li');
		expect(row).not.toBeNull();

		row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await screen.getByRole('menuitem', { name: 'Delete' }).click();
		const dialog = screen.getByRole('dialog');
		await dialog.getByRole('button', { name: 'Delete' }).click();

		await expect.element(dialog.getByText('Workspace write failed')).toBeVisible();
		expect(sequenceStore.projectTimeline().items.map((candidate) => candidate.id)).toEqual([
			'source'
		]);
		expect(mediaPool.get(interview.id)?.id).toBe(interview.id);
		expect(deleteProjectMedia).not.toHaveBeenCalled();
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
		await vi.waitFor(
			() => {
				expect(screen.container.querySelector('img[src^="blob:"]')).not.toBeNull();
			},
			{ timeout: 5_000 }
		);
		const sequenceRow = screen.getByText('Scene').element().closest('li')!;
		sequenceRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await screen.getByRole('menuitem', { name: 'Rename' }).click();
		const rename = screen.getByRole('textbox', { name: 'Rename' });
		await rename.fill('Opening');
		await userEvent.keyboard('{Enter}');

		await expect.element(screen.getByText('Opening')).toBeVisible();
		expect(sequenceStore.projectTimeline().items[0]?.label).toBe('Opening');
		expect(commandHistory.getLastCommandType()).toBe('RENAME_SEQUENCE');

		commandHistory.undo();
		await expect.element(screen.getByText('Scene')).toBeVisible();
		expect(sequenceStore.projectTimeline().items[0]?.label).toBe('Scene');

		await screen.getByRole('button', { name: 'Sequence options: Scene' }).click();
		await expect.element(screen.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
		await screen.getByRole('menuitem', { name: 'Rename' }).click();
		await screen.getByRole('textbox', { name: 'Rename' }).fill('Cancelled name');
		await userEvent.keyboard('{Escape}');
		await expect.element(screen.getByText('Scene')).toBeVisible();
		expect(commandHistory.undoStack).toHaveLength(0);

		await screen.getByRole('button', { name: 'Sequence options: Scene' }).click();
		await screen.getByRole('menuitem', { name: 'Place on timeline' }).click();
		expect(mediaPlacement.request?.payload).toMatchObject({
			source: 'composition',
			id: 'scene',
			label: 'Scene'
		});
		mediaPlacement.cancel();

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
