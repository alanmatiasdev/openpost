import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { editorSession } from '../editor.svelte';
import { mediaPool } from '../media/pool.svelte';
import { mediaRecovery } from '../media/media-recovery.svelte';
import type { MediaMetadata } from '../media/types';
import { sequenceStore } from '../sequences/sequence-store.svelte';
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
	mediaPool.clear();
	mediaRecovery.reset();
	sequenceStore.reset();
	editorSession.project = null;
});

describe('MediaPoolList', () => {
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
