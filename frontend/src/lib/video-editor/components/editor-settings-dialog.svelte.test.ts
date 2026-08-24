import { beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { mediaPool } from '../media/pool.svelte';
import { editorSettings } from '../settings/editor-settings.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import EditorSettingsDialog from './editor-settings-dialog.svelte';
import '../../../routes/layout.css';

beforeEach(() => {
	editorSettings.reset();
	mediaPool.clear();
	timelineStore.__resetForTesting();
});

describe('EditorSettingsDialog', () => {
	it('fits a phone and applies persistent general, timeline, and AI defaults', async () => {
		await page.viewport(320, 720);
		const screen = await render(EditorSettingsDialog, { open: true });
		const dialog = screen.getByRole('dialog');

		await expect.element(dialog).toBeVisible();
		expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);
		const periodicSave = screen.getByRole('switch', { name: 'Periodic safety save' });
		await expect.element(periodicSave).toHaveAttribute('aria-checked', 'true');
		await expect.element(screen.getByRole('slider', { name: 'Safety interval' })).toBeVisible();
		await periodicSave.click();
		expect(editorSettings.autoSaveIntervalMinutes).toBe(0);
		await expect
			.element(screen.getByRole('slider', { name: 'Safety interval' }))
			.not.toBeInTheDocument();
		await periodicSave.click();
		expect(editorSettings.autoSaveIntervalMinutes).toBe(5);

		const undoDepth = screen.getByLabelText('Undo history depth');
		await undoDepth.fill('30');
		await screen.getByRole('button', { name: 'Timeline' }).click();
		expect(editorSettings.maxUndoHistory).toBe(30);
		expect(timelineStore.maxUndoHistory).toBe(30);

		const waveforms = screen.getByRole('switch', { name: 'Show audio waveforms' });
		await expect.element(waveforms).toHaveAttribute('aria-checked', 'true');
		await waveforms.click();
		expect(editorSettings.showWaveforms).toBe(false);

		await screen.getByRole('button', { name: 'Local AI' }).click();
		await screen.getByRole('combobox', { name: /Speech model/ }).selectOptions('whisper-small');
		expect(editorSettings.defaultTranscriptionModel).toBe('whisper-small');

		await screen.getByRole('button', { name: 'Storage' }).click();
		await expect
			.element(screen.getByText(/Source media and project edits are never removed here/))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
	});
});
