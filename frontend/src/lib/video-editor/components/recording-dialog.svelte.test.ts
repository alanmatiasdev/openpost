import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { recorder } from '../recorder/recorder.svelte';
import RecordingDialog from './recording-dialog.svelte';
import '../../../routes/layout.css';

beforeEach(async () => {
	await recorder.cancel();
	await recorder.clearRecoverableAndDiscard();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('RecordingDialog', () => {
	it('keeps the complete preflight clear and usable at 320 pixels', async () => {
		await page.viewport(320, 760);
		const screen = await render(RecordingDialog, {
			open: true,
			projectId: 'project',
			onopenchange: vi.fn(),
			oninserted: vi.fn()
		});
		const dialog = screen.getByRole('dialog');

		await expect.element(screen.getByRole('heading', { name: 'Record screen' })).toBeVisible();
		await expect.element(screen.getByRole('checkbox', { name: 'Screen' })).toBeChecked();
		await expect.element(screen.getByRole('checkbox', { name: 'Camera' })).not.toBeChecked();
		await expect.element(screen.getByRole('checkbox', { name: 'Microphone' })).toBeChecked();
		await expect.element(screen.getByRole('checkbox', { name: /System audio/ })).toBeChecked();
		await expect.element(screen.getByText('Planned length')).toBeVisible();
		await expect.element(screen.getByText('5 minutes')).toBeVisible();
		await expect.element(screen.getByText(/working headroom/)).toBeVisible();

		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);
		for (const button of dialog.element().querySelectorAll<HTMLButtonElement>('button')) {
			if (button.offsetParent !== null) {
				const label = button.getAttribute('aria-label') ?? button.textContent?.trim();
				if (label) expect(button.getBoundingClientRect().height, label).toBeGreaterThanOrEqual(44);
			}
		}

		await screen.getByRole('checkbox', { name: 'Screen' }).click();
		await screen.getByRole('checkbox', { name: 'Microphone' }).click();
		await expect.element(screen.getByText('Select at least one source to record.')).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Start recording' })).toBeDisabled();
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);

		await page.screenshot({
			path: '../../../../.svelte-kit/openpost-recording-dialog-320.png'
		});
	});

	it('replaces start controls with a single cancel path while permission is pending', async () => {
		const screen = await render(RecordingDialog, {
			open: true,
			projectId: 'project',
			onopenchange: vi.fn(),
			oninserted: vi.fn()
		});
		recorder.status = 'requesting';

		await expect
			.element(screen.getByText('Complete the browser prompt to begin recording.'))
			.toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: 'Start recording' }))
			.not.toBeInTheDocument();
		await screen.getByRole('button', { name: 'Cancel' }).click();
		expect(recorder.status).toBe('idle');
	});

	it('offers recovered capture tracks for download, insertion, or explicit removal', async () => {
		await page.viewport(320, 760);
		const artifacts = [
			{
				kind: 'screen' as const,
				blob: new Blob(['recovered-screen'], { type: 'video/webm' }),
				mimeType: 'video/webm',
				durationMs: 2_000,
				startOffsetMs: 0,
				sizeBytes: 16,
				scratchId: 'screen-session-123-file',
				recoverySessionId: 'session-123'
			}
		];
		vi.spyOn(recorder, 'loadRecoverableArtifacts').mockImplementation(async () => {
			recorder.lastArtifacts = artifacts;
			return artifacts;
		});
		vi.spyOn(recorder, 'clearRecoverableAndDiscard').mockImplementation(async () => {
			recorder.lastArtifacts = [];
		});

		const screen = await render(RecordingDialog, {
			open: true,
			projectId: 'project',
			onopenchange: vi.fn(),
			oninserted: vi.fn()
		});

		await expect
			.element(screen.getByText(/A recording stopped before it was finalized/))
			.toBeVisible();
		await expect.element(screen.getByRole('link', { name: 'Download screen' })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Recover recording' })).toBeVisible();
		await new Promise((resolve) => setTimeout(resolve, 150));
		const dialog = screen.getByRole('dialog').element();
		expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
		for (const control of [
			screen.getByRole('button', { name: 'Recover recording' }).element(),
			screen.getByRole('button', { name: 'Remove incomplete recording' }).element()
		]) {
			expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
		}
		screen
			.getByRole('button', { name: 'Recover recording' })
			.element()
			.scrollIntoView({ block: 'center' });
		await page.screenshot({
			path: '../../../../.svelte-kit/openpost-recording-recovery-320.png'
		});
		await screen.getByRole('button', { name: 'Remove incomplete recording' }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Recover recording' }))
			.not.toBeInTheDocument();
	});
});
