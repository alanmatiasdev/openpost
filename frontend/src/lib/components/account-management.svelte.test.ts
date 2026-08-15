import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { client, type Workspace } from '$lib/api/client';
import AccountManagement from './account-management.svelte';

const getMock = vi.fn();
vi.spyOn(client, 'GET').mockImplementation(getMock);

const workspace = {
	id: 'workspace-62',
	name: 'Issue 62 Workspace',
	organization_id: 'organization-62',
	can_edit: true,
	created_at: '2026-08-09T12:00:00Z',
	avatar_url: '',
	color: '',
	organization_name: '',
	role: 'admin',
	sso_required: false,
	sso_authenticated: true,
	sso_identity_linked: true
} satisfies Workspace;

const links = {
	createPublicationHref: '/',
	createWorkspaceHref: '/',
	billingHref: '/settings?tab=plan',
	mastodonCallbackHref: '/accounts/mastodon/callback'
};

describe('account management modes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getMock.mockImplementation((path: string) => {
			if (path === '/accounts') return Promise.resolve({ data: [], error: null });
			return Promise.resolve({ data: [], error: null });
		});
	});

	it('renders direct navigation without inferring or redirecting from route state', async () => {
		const screen = await render(AccountManagement, {
			mode: 'direct',
			workspace,
			workspaces: [workspace],
			links,
			onContinue: vi.fn(),
			onAccountsChanged: vi.fn()
		});

		await expect
			.element(screen.getByRole('heading', { level: 1, name: 'Social accounts' }))
			.toBeVisible();
		await expect.element(screen.getByTestId('settings-navigation')).toBeVisible();
		expect(getMock).toHaveBeenCalledWith('/accounts', {
			params: { query: { workspace_id: 'workspace-62' } }
		});
	});

	it('embeds content in Settings and renders route-owned feedback', async () => {
		const onFeedbackDismiss = vi.fn();
		const screen = await render(AccountManagement, {
			mode: 'settings',
			workspace,
			workspaces: [workspace],
			links,
			feedback: {
				tone: 'error',
				message: 'The provider cancelled this connection.'
			},
			onFeedbackDismiss,
			onContinue: vi.fn(),
			onAccountsChanged: vi.fn()
		});

		await expect.element(screen.getByTestId('settings-navigation')).not.toBeInTheDocument();
		await expect.element(screen.getByText('The provider cancelled this connection.')).toBeVisible();
		await screen.getByRole('button', { name: 'Dismiss' }).click();
		expect(onFeedbackDismiss).toHaveBeenCalledOnce();
	});
});
