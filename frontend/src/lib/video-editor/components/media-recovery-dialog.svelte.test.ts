import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { mediaRecovery } from '../media/media-recovery.svelte';
import { mediaPool } from '../media/pool.svelte';
import type { MediaMetadata } from '../media/types';
import MediaRecoveryDialog from './media-recovery-dialog.svelte';
import '../../../routes/layout.css';

const replacement: MediaMetadata = {
	id: 'replacement',
	storageType: 'workspace',
	fileName: 'B-roll.mp4',
	fileSize: 1_000,
	mimeType: 'video/mp4',
	duration: 5,
	width: 1920,
	height: 1080,
	fps: 30,
	codec: 'avc',
	bitrate: 1_000_000,
	tags: ['video']
};

beforeEach(() => {
	mediaRecovery.reset();
	mediaPool.loadAll([replacement]);
	mediaRecovery.sourceIssues = [
		{ mediaId: replacement.id, fileName: replacement.fileName, kind: 'permission' }
	];
	mediaRecovery.orphanedClips = [
		{
			itemId: 'orphan',
			mediaId: 'missing',
			label: replacement.fileName,
			itemType: 'video'
		}
	];
	mediaRecovery.open = true;
});

describe('MediaRecoveryDialog', () => {
	it('explains both recovery paths and keeps replacement selection usable at 320 pixels', async () => {
		await page.viewport(320, 720);
		const screen = await render(MediaRecoveryDialog, { onedit: vi.fn() });
		const dialog = screen.getByRole('dialog');

		await expect
			.element(screen.getByRole('heading', { name: 'Restore project media' }))
			.toBeVisible();
		await expect.element(screen.getByRole('heading', { name: 'Unavailable files' })).toBeVisible();
		await expect
			.element(screen.getByRole('heading', { name: 'Clips without media' }))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Grant access' })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Match by filename' })).toBeVisible();
		expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);

		await screen.getByRole('button', { name: 'Choose asset' }).click();
		await expect.element(screen.getByRole('heading', { name: 'Replace B-roll.mp4' })).toBeVisible();
		await expect.element(screen.getByText('0:05')).toBeVisible();
		await screen.getByRole('button', { name: 'Back' }).click();
		await screen.getByRole('button', { name: 'Work offline' }).click();
		await expect.element(dialog).not.toBeInTheDocument();
		expect(mediaRecovery.issueCount).toBe(2);
	});
});
