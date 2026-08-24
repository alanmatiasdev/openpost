import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import RenderProgress from './render-progress.svelte';
import '../../../routes/layout.css';

describe('RenderProgress', () => {
	it('shows phase, frame, percent, and elapsed counters without phone overflow', async () => {
		await page.viewport(320, 720);
		const screen = await render(RenderProgress, {
			progress: {
				phase: 'rendering',
				framesDone: 42,
				totalFrames: 100,
				progress: 0.42
			},
			startedAt: 1_000,
			clock: () => 66_000
		});

		await expect.element(screen.getByText('Rendering frames')).toBeVisible();
		await expect.element(screen.getByText('42%')).toBeVisible();
		await expect.element(screen.getByText('Frame 42 / 100')).toBeVisible();
		await expect.element(screen.getByText('Elapsed 1:05')).toBeVisible();
		const progressbar = screen.getByRole('progressbar');
		await expect.element(progressbar).toHaveAttribute('aria-valuenow', '42');
		const panel = screen.getByTestId('render-progress').element();
		expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);

		await screen.rerender({
			progress: {
				phase: 'encoding',
				framesDone: 75,
				totalFrames: 100,
				progress: 0.75
			},
			startedAt: 1_000,
			clock: () => 66_000
		});
		await expect.element(screen.getByText('Encoding output')).toBeVisible();
		await expect.element(screen.getByText('Frame 42 / 100')).not.toBeInTheDocument();

		await screen.rerender({
			progress: {
				phase: 'finalizing',
				framesDone: 100,
				totalFrames: 100,
				progress: 1
			},
			startedAt: 1_000,
			clock: () => 66_000
		});
		await expect.element(screen.getByText('Finishing file')).toBeVisible();
		await expect.element(screen.getByText('100%')).toBeVisible();
	});
});
