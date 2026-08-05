import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { User } from '$lib/api/client';
import { auth } from '$lib/stores/auth';
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
	afterEach(() => auth.setUser(null));

	it('keeps the spacious text-and-thread writing canvas for the default post preset', async () => {
		const screen = await render(ComposeShell);
		const modeSelect = screen.getByTestId('composer-mode-select');

		await expect.element(modeSelect).toBeVisible();
		await expect.element(screen.getByTestId('text-thread-composer-shell')).toBeVisible();
		await expect.element(modeSelect).toHaveTextContent('Post');
		expect(screen.container.querySelector('[data-testid="focused-composer"]')).toBeNull();
	});

	it('uses the unified publication composer for the default post preset when selected', async () => {
		auth.setUser({ composer_experience: 'unified' } as User);

		const screen = await render(ComposeShell);

		await expect.element(screen.getByTestId('focused-composer')).toBeVisible();
		expect(screen.container.querySelector('[data-testid="text-thread-composer-shell"]')).toBeNull();
	});
});
