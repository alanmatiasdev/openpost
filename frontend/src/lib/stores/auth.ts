import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import { client, setToken, recreateClient, type User } from '$lib/api/client';
import { getPasskeyAssertion } from '$lib/auth/webauthn';
import { IS_CAPACITOR } from '$lib/env';

interface AuthState {
	user: User | null;
	isLoading: boolean;
	isAuthenticated: boolean;
}

interface AuthActionResult {
	success: boolean;
	error?: string;
	requiresMfa?: boolean;
	mfaToken?: string;
	mfaMethods?: string[];
	purpose?: 'login' | 'reauth' | 'link';
	action?: string;
	reauthGrant?: string;
	requiresEmailVerification?: boolean;
	emailVerificationID?: string;
	emailVerificationEmail?: string;
	emailDeliveryStatus?: 'sent' | 'failed';
}

interface RegisterInput {
	email: string;
	username?: string;
	password: string;
	acceptedLegal: boolean;
}

function createAuthStore() {
	const { subscribe, set, update } = writable<AuthState>({
		user: null,
		isLoading: true,
		isAuthenticated: false
	});

	return {
		subscribe,
		async initialize(options: { optional?: boolean } = {}) {
			if (!browser) return;

			// Recreate client in case instance URL was just set
			recreateClient();

			try {
				if (options.optional) {
					const { data, error } = await client.GET('/auth/session-state');
					if (error || !data?.authenticated || !data.user) {
						setToken(null);
						set({ user: null, isLoading: false, isAuthenticated: false });
						return;
					}
					set({ user: data.user, isLoading: false, isAuthenticated: true });
					return;
				}
				const { data, error } = await client.GET('/auth/me');
				if (error || !data) throw new Error('Failed to fetch user');
				set({ user: data, isLoading: false, isAuthenticated: true });
			} catch {
				setToken(null);
				set({ user: null, isLoading: false, isAuthenticated: false });
			}
		},
		async login(email: string, password: string): Promise<AuthActionResult> {
			try {
				const { data, error } = await client.POST('/auth/login', {
					body: { email, password }
				});
				if (error || !data) throw new Error(error?.detail ?? 'Login failed');
				if (data.requires_mfa) {
					set({ user: null, isLoading: false, isAuthenticated: false });
					return {
						success: false,
						requiresMfa: true,
						mfaToken: data.mfa_token,
						mfaMethods: data.mfa_methods ?? []
					};
				}
				if (data.requires_email_verification) {
					set({ user: null, isLoading: false, isAuthenticated: false });
					return emailVerificationResult(data);
				}
				setToken(IS_CAPACITOR ? data.token : null);
				set({ user: data.user ?? null, isLoading: false, isAuthenticated: true });
				return { success: true };
			} catch (e) {
				return { success: false, error: (e as Error).message };
			}
		},
		async register({ email, username, password, acceptedLegal }: RegisterInput) {
			try {
				const { data, error } = await client.POST('/auth/register', {
					body: { email, username: username || undefined, password, accepted_legal: acceptedLegal }
				});
				if (error || !data) throw new Error(error?.detail || 'Registration failed');
				if (data.requires_email_verification) {
					set({ user: null, isLoading: false, isAuthenticated: false });
					return emailVerificationResult(data);
				}
				setToken(IS_CAPACITOR ? data.token : null);
				set({ user: data.user ?? null, isLoading: false, isAuthenticated: true });
				return { success: true };
			} catch (e) {
				return { success: false, error: (e as Error).message };
			}
		},
		async verifyEmail(challengeID: string, code: string): Promise<AuthActionResult> {
			try {
				const { data, error } = await client.POST('/auth/email-verification/confirm', {
					body: { challenge_id: challengeID, code }
				});
				if (error || !data?.user) throw new Error(error?.detail ?? 'Email verification failed');
				setToken(IS_CAPACITOR ? data.token : null);
				set({ user: data.user, isLoading: false, isAuthenticated: true });
				return { success: true };
			} catch (e) {
				return { success: false, error: (e as Error).message };
			}
		},
		async resendEmailVerification(challengeID: string): Promise<AuthActionResult> {
			try {
				const { data, error } = await client.POST('/auth/email-verification/resend', {
					body: { challenge_id: challengeID }
				});
				if (error || !data?.requires_email_verification) {
					throw new Error(error?.detail ?? 'Unable to send another verification code');
				}
				return emailVerificationResult(data);
			} catch (e) {
				return { success: false, error: (e as Error).message };
			}
		},
		async verifyTOTP(mfaToken: string, code: string): Promise<AuthActionResult> {
			try {
				const { data, error } = await client.POST('/auth/login/totp', {
					body: { mfa_token: mfaToken, code }
				});
				if (error || !data) throw new Error(error?.detail ?? 'Authenticator verification failed');
				setToken(IS_CAPACITOR ? data.token : null);
				set({ user: data.user ?? null, isLoading: false, isAuthenticated: true });
				return { success: true };
			} catch (e) {
				return { success: false, error: (e as Error).message };
			}
		},
		async verifyPasskey(mfaToken: string): Promise<AuthActionResult> {
			try {
				const { data: beginData, error: beginError } = await client.POST(
					'/auth/login/passkey/options',
					{
						body: { mfa_token: mfaToken }
					}
				);
				if (beginError || !beginData) {
					throw new Error(beginError?.detail || 'Unable to start passkey verification');
				}

				const credential = await getPasskeyAssertion(beginData.options);
				const { data, error } = await client.POST('/auth/login/passkey/verify', {
					body: {
						challenge_id: beginData.challenge_id,
						credential
					}
				});
				if (error || !data) throw new Error(error?.detail ?? 'Passkey verification failed');

				setToken(IS_CAPACITOR ? data.token : null);
				set({ user: data.user ?? null, isLoading: false, isAuthenticated: true });
				return { success: true };
			} catch (e) {
				return { success: false, error: (e as Error).message };
			}
		},
		async consumeOIDCHandoff(code: string): Promise<AuthActionResult> {
			try {
				const { data, error } = await client.POST('/auth/oidc/handoff', {
					body: { code }
				});
				if (error || !data?.purpose) {
					throw new Error(error?.detail ?? 'Single sign-on could not be completed');
				}
				if (data.purpose === 'login') {
					if (!data.token || !data.user) throw new Error('Single sign-on response is incomplete');
					setToken(data.token);
					set({ user: data.user, isLoading: false, isAuthenticated: true });
				}
				return {
					success: true,
					purpose: data.purpose,
					action: data.action,
					reauthGrant: data.reauth_grant
				};
			} catch (e) {
				return { success: false, error: (e as Error).message };
			}
		},
		async logout() {
			try {
				await client.POST('/auth/logout');
			} catch {
				// Local state must still be cleared if the server is unavailable.
			}
			this.clearLocal();
		},
		clearLocal() {
			setToken(null);
			set({ user: null, isLoading: false, isAuthenticated: false });
		},
		setUser(user: User | null) {
			update((state) => ({
				...state,
				user,
				isAuthenticated: Boolean(user)
			}));
		}
	};
}

export const auth = createAuthStore();

function emailVerificationResult(data: {
	email_verification_id?: string;
	email_verification_email?: string;
	email_delivery_status?: 'sent' | 'failed';
}): AuthActionResult {
	return {
		success: false,
		requiresEmailVerification: true,
		emailVerificationID: data.email_verification_id,
		emailVerificationEmail: data.email_verification_email,
		emailDeliveryStatus: data.email_delivery_status
	};
}
