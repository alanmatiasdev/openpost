import { afterEach, describe, expect, it, vi } from 'vitest';
import { client } from '$lib/api/client';
import { createAuthStore } from './auth';

const apiMocks = {
	post: vi.fn()
};

const auth = createAuthStore({
	client: { GET: client.GET, POST: apiMocks.post },
	getPasskeyAssertion: vi.fn(),
	notificationInbox: { clear: vi.fn() },
	identifyTelemetryUser: vi.fn(),
	resetTelemetryIdentity: vi.fn()
});

describe('auth recovery-code verification', () => {
	afterEach(() => {
		auth.clearLocal();
		apiMocks.post.mockReset();
	});

	it('submits the pending MFA token and authenticates after a valid recovery code', async () => {
		const user = {
			id: 'user-1',
			email: 'person@example.com',
			username: 'person',
			public_profile_enabled: false,
			is_admin: false,
			is_managed: false,
			has_password: true,
			legal_acceptance_required: false,
			email_verified: true,
			created_at: '2026-08-09T00:00:00Z'
		};
		apiMocks.post.mockResolvedValue({ data: { token: 'session-token', user } });

		const result = await auth.verifyRecoveryCode('mfa-challenge', 'ABCD-EFGH-JKMP-QRST');

		expect(result).toEqual({ success: true });
		expect(apiMocks.post).toHaveBeenCalledWith('/auth/login/recovery-code', {
			body: {
				mfa_token: 'mfa-challenge',
				code: 'ABCD-EFGH-JKMP-QRST'
			}
		});
		let current: { isAuthenticated: boolean; user: { id: string } | null } | undefined;
		const unsubscribe = auth.subscribe((state) => {
			current = state;
		});
		unsubscribe();
		expect(current).toMatchObject({ isAuthenticated: true, user: { id: 'user-1' } });
	});

	it('keeps the pending login unauthenticated when the code is rejected', async () => {
		apiMocks.post.mockResolvedValue({
			error: { detail: 'invalid recovery code' }
		});

		const result = await auth.verifyRecoveryCode('mfa-challenge', 'USED-CODE');

		expect(result).toEqual({ success: false, error: 'invalid recovery code' });
	});
});
