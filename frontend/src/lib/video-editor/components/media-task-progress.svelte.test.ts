import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { mediaTasks } from '../media/media-tasks.svelte';
import MediaTaskProgress from './media-task-progress.svelte';
import '../../../routes/layout.css';

beforeEach(() => mediaTasks.reset());

describe('MediaTaskProgress', () => {
	it('shows real progress, expands details, cancels owners, and fits on a phone', async () => {
		await page.viewport(320, 720);
		const cancel = vi.fn();
		const screen = await render(MediaTaskProgress);
		await expect
			.element(screen.getByRole('region', { name: 'Background tasks' }))
			.not.toBeInTheDocument();

		mediaTasks.start({
			id: 'proxy:camera',
			kind: 'proxy',
			mediaId: 'camera',
			label: 'Camera.mov',
			progress: 0.42,
			onCancel: cancel
		});
		const region = screen.getByRole('region', { name: 'Background tasks' });
		await expect.element(region).toBeVisible();
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
		await expect.element(region.getByText('Creating preview proxy')).toBeVisible();
		await expect.element(region.getByText('42%')).toBeVisible();
		await expect.element(region.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');

		await region.getByRole('button', { name: 'Creating preview proxy' }).click();
		await expect.element(region.getByText('Camera.mov')).toBeVisible();
		await region.getByRole('button', { name: 'Cancel: Camera.mov' }).click();
		expect(cancel).toHaveBeenCalledOnce();
		await expect.element(region.getByRole('button', { name: 'Cancelling' })).toBeVisible();

		mediaTasks.start({
			id: 'waveform:voice',
			kind: 'waveform',
			mediaId: 'voice',
			label: 'Voice.wav',
			progress: null
		});
		await expect.element(region.getByText('2 background tasks')).toBeVisible();
		await expect.element(region.getByText('Voice.wav')).toBeVisible();
		await expect.element(region.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
		expect(region.element().scrollWidth).toBeLessThanOrEqual(region.element().clientWidth);
	});
});
