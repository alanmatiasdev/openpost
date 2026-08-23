import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { importRemoteLottie } from '$lib/video-editor/media/import.svelte';
import { fetchLottieAnimations } from '$lib/video-editor/lottie/lottiefiles-api';
import LottieBrowserPanel from './lottie-browser-panel.svelte';

vi.mock('$lib/video-editor/media/import.svelte', () => ({
	importRemoteLottie: vi.fn(async () => 'media-id')
}));

vi.mock('$lib/video-editor/lottie/lottiefiles-api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/video-editor/lottie/lottiefiles-api')>();
	return {
		...actual,
		fetchLottieAnimations: vi.fn(async () => ({
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
		}))
	};
});

beforeEach(() => {
	vi.mocked(importRemoteLottie).mockClear();
	vi.mocked(fetchLottieAnimations).mockClear();
});

describe('LottieBrowserPanel', () => {
	it('loads, attributes, and imports a public animation in a compact asset panel', async () => {
		const screen = await render(LottieBrowserPanel, { projectId: 'project' });
		await expect.element(screen.getByText('Wave hello')).toBeVisible();
		await screen.getByRole('button', { name: 'Add to media' }).click();
		await vi.waitFor(() => expect(importRemoteLottie).toHaveBeenCalledTimes(1));
		expect(importRemoteLottie).toHaveBeenCalledWith({
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
