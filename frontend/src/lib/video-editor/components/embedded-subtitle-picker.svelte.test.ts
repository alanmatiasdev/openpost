import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { EmbeddedSubtitleInsertResult } from '../media/embedded-subtitle-service';
import type { EmbeddedSubtitleTrack } from '../media/embedded-subtitles';
import type { MediaMetadata } from '../media/types';
import EmbeddedSubtitlePicker from './embedded-subtitle-picker.svelte';
import '../../../routes/layout.css';

const media: MediaMetadata = {
	id: 'interview',
	storageType: 'workspace',
	fileName: 'interview.mkv',
	fileSize: 10_000,
	mimeType: 'video/x-matroska',
	duration: 30,
	width: 1920,
	height: 1080,
	fps: 30,
	codec: 'h264',
	bitrate: 1,
	tags: ['video']
};

const english: EmbeddedSubtitleTrack = {
	trackNumber: 1,
	codecId: 'S_TEXT/UTF8',
	language: 'eng',
	name: 'English',
	default: true,
	forced: false,
	cues: [{ id: 'english', startSeconds: 0, endSeconds: 1, text: 'Hello' }]
};

const portuguese: EmbeddedSubtitleTrack = {
	trackNumber: 2,
	codecId: 'S_TEXT/ASS',
	language: 'por',
	name: 'Português',
	default: false,
	forced: true,
	cues: [
		{ id: 'one', startSeconds: 0, endSeconds: 1, text: 'Olá' },
		{ id: 'two', startSeconds: 1, endSeconds: 2, text: 'Mundo' }
	]
};

describe('EmbeddedSubtitlePicker', () => {
	it('scans, prefers forced tracks, lets the user choose, and inserts the selected cues', async () => {
		await page.viewport(320, 720);
		const resolve = vi.fn(async () => new Blob(['fixture']));
		const scan = vi.fn(async (_media, blob, options) => {
			options?.onProgress?.({ bytesRead: blob.size, totalBytes: blob.size, clusters: 1 });
			return { tracks: [english, portuguese], scannedAt: 100, fromCache: true };
		});
		const inserted: EmbeddedSubtitleInsertResult = {
			itemIds: ['subtitle'],
			cueCount: 1,
			trackLabel: 'English'
		};
		const insert = vi.fn(() => inserted);
		const oninsert = vi.fn();
		const screen = await render(EmbeddedSubtitlePicker, {
			media,
			open: true,
			canvasWidth: 1920,
			canvasHeight: 1080,
			oninsert,
			resolve,
			scan,
			insert
		});

		await expect.element(screen.getByText('Português')).toBeVisible();
		const dialog = screen.getByRole('dialog').element();
		expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
		expect(screen.getByRole('radio', { name: /Português/ }).element().dataset.state).toBe(
			'checked'
		);
		await screen.getByRole('radio', { name: /English/ }).click();
		await screen.getByRole('button', { name: 'Insert 1 cue' }).click();

		expect(resolve).toHaveBeenCalledWith(media);
		expect(scan).toHaveBeenCalledOnce();
		expect(insert).toHaveBeenCalledWith(media, english, {
			canvasWidth: 1920,
			canvasHeight: 1080
		});
		expect(oninsert).toHaveBeenCalledWith(inserted);
		await page.viewport(1280, 720);
	});
});
