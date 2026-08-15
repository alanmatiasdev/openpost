import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { client } from '$lib/api/client';
import BillingRecoveryNotice from './billing-recovery-notice.svelte';

const mocks = { get: vi.fn(), post: vi.fn() };
vi.spyOn(client, 'GET').mockImplementation(mocks.get);
vi.spyOn(client, 'POST').mockImplementation(mocks.post);

function billingStatus(canManageBilling: boolean, status = 'past_due') {
	return {
		organization_id: 'org-1',
		workspace_id: 'workspace-1',
		status,
		can_manage_billing: canManageBilling,
		access_restricted: status === 'past_due',
		past_due_since: status === 'past_due' ? '2026-08-09T12:00:00Z' : undefined,
		cancel_at_period_end: false,
		limits: {},
		usage: {},
		period_start: '2026-08-01T00:00:00Z',
		provider_costs: []
	};
}

describe('BillingRecoveryNotice', () => {
	beforeEach(() => {
		mocks.get.mockReset();
		mocks.post.mockReset();
	});

	it('gives an organization admin one exact payment recovery action and clears on recovery', async () => {
		await page.viewport(390, 844);
		mocks.get.mockResolvedValue({ data: billingStatus(true) });
		mocks.post.mockResolvedValue({ error: { detail: 'Temporary portal error' } });
		const screen = await render(BillingRecoveryNotice, { workspaceID: 'workspace-1' });

		const notice = screen.getByTestId('billing-recovery-notice');
		await expect.element(notice).toBeVisible();
		await expect.element(notice).toHaveTextContent('Payment action required');
		await expect.element(notice).toHaveTextContent('Past due since Aug 9, 2026');
		await screen.getByRole('button', { name: 'Update payment method' }).click();

		expect(mocks.post).toHaveBeenCalledWith('/billing/portal', {
			body: {
				workspace_id: 'workspace-1',
				purpose: 'update_payment_method'
			}
		});
		await expect.element(notice).toHaveTextContent('Temporary portal error');
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);

		mocks.get.mockResolvedValue({ data: billingStatus(true, 'active') });
		window.dispatchEvent(new Event('focus'));
		await expect.element(notice).not.toBeInTheDocument();
	});

	it('shows the same failed-payment state without a billing action to a member', async () => {
		mocks.get.mockResolvedValue({ data: billingStatus(false) });
		const screen = await render(BillingRecoveryNotice, { workspaceID: 'workspace-1' });

		const notice = screen.getByTestId('billing-recovery-notice');
		await expect.element(notice).toBeVisible();
		await expect
			.element(notice)
			.toHaveTextContent('Ask an organization owner or admin to update the payment method.');
		await expect
			.element(screen.getByRole('button', { name: 'Update payment method' }))
			.not.toBeInTheDocument();
		expect(mocks.post).not.toHaveBeenCalled();
	});
});
