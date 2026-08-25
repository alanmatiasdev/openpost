import { beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { mediaPool } from '../media/pool.svelte';
import { editorSettings } from '../settings/editor-settings.svelte';
import { keyboardShortcuts } from '../settings/keyboard-shortcuts.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { soundPreferences } from '$lib/stores/sound-preferences.svelte';
import EditorSettingsDialog from './editor-settings-dialog.svelte';
import '../../../routes/layout.css';

beforeEach(() => {
	editorSettings.reset();
	keyboardShortcuts.resetAll();
	soundPreferences.reset();
	mediaPool.clear();
	timelineStore.__resetForTesting();
});

describe('EditorSettingsDialog shortcuts', () => {
	it('rebinding a conflict replaces the old command and fits a 320px phone', async () => {
		await page.viewport(320, 720);
		const screen = await render(EditorSettingsDialog, { open: true });
		const dialog = screen.getByRole('dialog');
		await screen.getByRole('button', { name: 'Shortcuts' }).click();
		expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);

		const search = screen.getByPlaceholder('Search commands or keys');
		await search.fill('Play or pause');
		const play = screen.getByRole('group', { name: 'Play or pause' });
		await play.getByRole('button', { name: 'Change' }).click();
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: ' ',
				code: 'Space',
				shiftKey: true,
				bubbles: true,
				cancelable: true
			})
		);
		await screen.getByRole('button', { name: 'Use shortcut' }).click();
		expect(keyboardShortcuts.bindings.PLAY_PAUSE).toBe('shift+space');

		await search.fill('Save project');
		const save = screen.getByRole('group', { name: 'Save project' });
		await save.getByRole('button', { name: 'Change' }).click();
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: ' ',
				code: 'Space',
				shiftKey: true,
				bubbles: true,
				cancelable: true
			})
		);
		await expect
			.element(screen.getByRole('alert'))
			.toHaveTextContent('Already used by Play or pause.');
		await screen.getByRole('button', { name: 'Replace existing' }).click();
		expect(keyboardShortcuts.bindings.SAVE).toBe('shift+space');
		expect(keyboardShortcuts.bindings.PLAY_PAUSE).toBe('');

		await screen.getByRole('button', { name: 'Reset all' }).click();
		await screen.getByRole('button', { name: 'Reset all' }).click();
		expect(keyboardShortcuts.bindings.PLAY_PAUSE).toBe('space');
		expect(keyboardShortcuts.bindings.SAVE).toBe('mod+s');
		expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);
	});
});

describe('EditorSettingsDialog', () => {
	it('offers the supported app languages from the editor settings', async () => {
		const screen = await render(EditorSettingsDialog, { open: true });
		const language = screen.getByRole('combobox', { name: 'Language' });
		await expect.element(language).toHaveValue('en');
		await expect.element(language.getByRole('option', { name: 'English' })).toBeInTheDocument();
		await expect.element(language.getByRole('option', { name: 'Español' })).toBeInTheDocument();
		await expect.element(language.getByRole('option', { name: 'Deutsch' })).toBeInTheDocument();
		await expect.element(language.getByRole('option', { name: 'Português' })).toBeInTheDocument();
		await expect.element(language.getByRole('option', { name: '日本語' })).toBeInTheDocument();
		await expect.element(language.getByRole('option', { name: '简体中文' })).toBeInTheDocument();
	});

	it('fits a phone and applies persistent general, timeline, and AI defaults', async () => {
		await page.viewport(320, 720);
		const screen = await render(EditorSettingsDialog, { open: true });
		const dialog = screen.getByRole('dialog');

		await expect.element(dialog).toBeVisible();
		expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);
		await expect
			.element(screen.getByRole('button', { name: 'General' }))
			.toHaveAttribute('data-cuelume-toggle', 'tick');
		const interfaceSounds = screen.getByRole('switch', { name: 'Interface sounds' });
		await expect.element(interfaceSounds).toHaveAttribute('aria-checked', 'false');
		await expect.element(interfaceSounds).not.toHaveAttribute('data-cuelume-toggle');
		await userEvent.click(interfaceSounds.element());
		expect(soundPreferences.enabled).toBe(true);
		await expect.element(screen.getByRole('slider', { name: 'Sound volume' })).toBeVisible();
		await screen.getByRole('combobox', { name: 'Sound theme' }).selectOptions('crisp');
		expect(soundPreferences.theme).toBe('crisp');
		await expect
			.element(screen.getByRole('button', { name: 'Preview sound' }))
			.not.toHaveAttribute('data-cuelume-toggle');
		interfaceSounds.element().focus();
		await userEvent.keyboard('{Enter}');
		expect(soundPreferences.enabled).toBe(false);

		const periodicSave = screen.getByRole('switch', { name: 'Periodic safety save' });
		await expect.element(periodicSave).toHaveAttribute('aria-checked', 'true');
		await expect.element(periodicSave).toHaveAttribute('data-cuelume-toggle', 'toggle');
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
