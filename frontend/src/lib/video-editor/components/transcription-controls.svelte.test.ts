import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TranscriptionControls from './transcription-controls.svelte';

function select(element: HTMLSelectElement, value: string): void {
	element.value = value;
	element.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('TranscriptionControls', () => {
	it('submits the chosen engine, language, and precision', async () => {
		const onstart = vi.fn();
		const screen = await render(TranscriptionControls, {
			canTranscribe: true,
			busy: false,
			progress: null,
			backend: null,
			fallback: null,
			onstart,
			oncancel: vi.fn()
		});
		const selects = screen.container.querySelectorAll('select');
		expect(selects).toHaveLength(3);
		select(selects[0]!, 'whisper-small');
		select(selects[1]!, 'pt');
		select(selects[2]!, 'q8');
		await screen.getByRole('button', { name: 'Auto-captions' }).click();
		expect(onstart).toHaveBeenCalledWith({
			model: 'whisper-small',
			language: 'pt',
			quantization: 'q8'
		});
	});

	it('shows staged progress and turns the main action into cancel', async () => {
		const oncancel = vi.fn();
		const screen = await render(TranscriptionControls, {
			canTranscribe: true,
			busy: true,
			progress: {
				stage: 'downloading',
				progress: 0.42,
				receivedBytes: 42,
				totalBytes: 100
			},
			backend: 'wasm',
			fallback: {
				engine: 'whisper',
				model: 'whisper-base',
				fallbackReason: 'no-webgpu'
			},
			onstart: vi.fn(),
			oncancel
		});
		const progress = screen.getByRole('progressbar', { name: 'Downloading model' }).element();
		expect(progress).toHaveAttribute('aria-valuenow', '42');
		await expect
			.element(screen.getByText('Using Whisper Base for this language or browser.'))
			.toBeVisible();
		await screen.getByRole('button', { name: 'Cancel transcription' }).click();
		expect(oncancel).toHaveBeenCalledOnce();
	});

	it('does not offer transcription without a selected media clip', async () => {
		const screen = await render(TranscriptionControls, {
			canTranscribe: false,
			busy: false,
			progress: null,
			backend: null,
			fallback: null,
			onstart: vi.fn(),
			oncancel: vi.fn()
		});
		await expect.element(screen.getByRole('button', { name: 'Auto-captions' })).toBeDisabled();
	});

	it('shows the selected clip queue position and keeps cancellation reachable at 320px', async () => {
		const oncancel = vi.fn();
		const screen = await render(TranscriptionControls, {
			canTranscribe: true,
			busy: true,
			status: 'queued',
			queuePosition: 2,
			queueTotal: 3,
			progress: null,
			backend: null,
			fallback: null,
			onstart: vi.fn(),
			oncancel
		});
		screen.container.style.width = '320px';
		await expect.element(screen.getByText('Queued 2 of 3')).toBeVisible();
		const cancel = screen.getByRole('button', { name: 'Cancel transcription' });
		await expect.element(cancel).toBeVisible();
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
		await cancel.click();
		expect(oncancel).toHaveBeenCalledOnce();
	});
});
