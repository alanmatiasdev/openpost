import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import LottieBrowserPanel from './lottie-browser-panel.svelte';

describe('LottieBrowserPanel', () => {
	it('loads, attributes, and imports a public animation in a compact asset panel', async () => {
		const importAnimation = vi.fn(async () => 'media-id');
		const fetchAnimations = vi.fn(async () => ({
			items: [
				{
					id: '42',
					name: 'Wave hello',
					lottieUrl: 'https://assets-v2.lottiefiles.com/wave.lottie',
					gifUrl: null,
					bgColor: '#ffffff',
					author: 'Ada',
					authorPath: '/ada'
				}
			],
			endCursor: null,
			hasNextPage: false,
			totalCount: 1
		}));
		const screen = await render(LottieBrowserPanel, {
			projectId: 'project',
			fetchAnimations,
			importAnimation
		});
		await expect.element(screen.getByText('Wave hello')).toBeVisible();
		await screen.getByRole('button', { name: 'Add to media' }).click();
		await vi.waitFor(() => expect(importAnimation).toHaveBeenCalledTimes(1));
		expect(importAnimation).toHaveBeenCalledWith({
			projectId: 'project',
			url: 'https://assets-v2.lottiefiles.com/wave.lottie',
			fileName: 'Wave hello',
			attribution: expect.objectContaining({
				provider: 'LottieFiles',
				author: 'Ada',
				licenseUrl: 'https://lottiefiles.com/page/license'
			})
		});
		await expect.element(screen.getByRole('button', { name: 'Added to media' })).toBeVisible();

		screen.container.style.width = '280px';
		const panel = screen.container.querySelector('[aria-label="LottieFiles"]');
		expect(panel).not.toBeNull();
		if (panel) expect(panel.scrollWidth).toBeLessThanOrEqual(280);
	});
});
