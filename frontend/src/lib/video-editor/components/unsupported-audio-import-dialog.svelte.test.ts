import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import UnsupportedAudioImportDialog from './unsupported-audio-import-dialog.svelte';

afterEach(async () => {
	await page.viewport(1280, 900);
});

describe('UnsupportedAudioImportDialog', () => {
	it('states the silent-track consequence before allowing an import', async () => {
		await page.viewport(320, 720);
		const ondecision = vi.fn();
		const screen = await render(UnsupportedAudioImportDialog, {
			open: true,
			fileName: 'feature-film.mkv',
			codec: 'DTS-HD MA',
			ondecision
		});

		await expect.element(screen.getByRole('dialog')).toBeVisible();
		await expect.element(screen.getByText(/feature-film\.mkv/)).toBeVisible();
		await expect.element(screen.getByText(/DTS-HD MA/)).toBeVisible();
		await expect
			.element(screen.getByText(/silent in previews, edits, transcripts, and exports/))
			.toBeVisible();
		const dialog = screen.getByRole('dialog').element();
		expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
		expect(
			screen.getByRole('button', { name: 'Import without audio' }).element().offsetHeight
		).toBe(44);

		await screen.getByRole('button', { name: 'Import without audio' }).click();
		expect(ondecision).toHaveBeenCalledOnce();
		expect(ondecision).toHaveBeenCalledWith('import');
	});

	it('treats closing the dialog as cancellation', async () => {
		const ondecision = vi.fn();
		const screen = await render(UnsupportedAudioImportDialog, {
			open: true,
			fileName: 'archive.mkv',
			codec: 'truehd',
			ondecision
		});

		await screen.getByRole('button', { name: 'Close' }).click();
		expect(ondecision).toHaveBeenCalledWith('cancel');
	});
});
