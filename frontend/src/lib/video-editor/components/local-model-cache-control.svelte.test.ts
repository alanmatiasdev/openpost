import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { localAiRuntimeRegistry } from '../local-ai/runtime-registry';
import LocalModelCacheControl from './local-model-cache-control.svelte';
import '../../../routes/layout.css';

describe('LocalModelCacheControl', () => {
	it('unloads resident model workers and stays within a 320px panel', async () => {
		await page.viewport(320, 720);
		let loaded = true;
		const unload = vi.fn(() => {
			loaded = false;
		});
		const unregister = localAiRuntimeRegistry.register({
			id: 'test-ui-runtime',
			label: 'Test UI runtime',
			isLoaded: () => loaded,
			unload
		});
		try {
			const screen = await render(LocalModelCacheControl);
			const root = screen.getByRole('button', { name: 'Models' }).element().parentElement!;
			await screen.getByRole('button', { name: 'Models' }).click();
			const unloadButton = screen.getByRole('button', { name: 'Unload' });
			await expect.element(unloadButton).toBeEnabled();
			await unloadButton.click();

			expect(unload).toHaveBeenCalledOnce();
			expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
		} finally {
			unregister();
		}
	});
});
