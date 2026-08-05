import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ComposeShell from './compose-shell.svelte';

vi.mock('$lib/api/client', () => ({
	client: {
		GET: vi.fn(async () => ({ data: [], error: null })),
		POST: vi.fn(async () => ({ data: null, error: null })),
		PATCH: vi.fn(async () => ({ data: null, error: null })),
		PUT: vi.fn(async () => ({ data: null, error: null })),
		DELETE: vi.fn(async () => ({ data: null, error: null }))
	},
	getToken: () => null,
	setToken: vi.fn(),
	recreateClient: vi.fn()
}));

describe('ComposeShell', () => {
	it('always uses the spacious text-and-thread writing canvas', async () => {
		const screen = await render(ComposeShell);

		await expect.element(screen.getByTestId('text-thread-composer-shell')).toBeVisible();
		expect(screen.container.querySelector('[data-testid="composer-mode-select"]')).toBeNull();
		expect(screen.container.querySelector('[data-testid="focused-composer"]')).toBeNull();
	});
});
