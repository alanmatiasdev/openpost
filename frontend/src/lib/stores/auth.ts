import { browser } from '$app/environment';
import { identifyTelemetryUser, resetTelemetryIdentity } from '@openpost/telemetry';
import { writable } from 'svelte/store';
import { client, type User } from '$lib/api/client';
import { getPasskeyAssertion } from '$lib/auth/webauthn';
import { notificationInbox } from '$lib/stores/notifications.svelte';

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
	purchaseChoiceToken?: string;
}

export interface AuthStoreDependencies {
	client: Pick<typeof client, 'GET' | 'POST'>;
	getPasskeyAssertion: typeof getPasskeyAssertion;
	notificationInbox: Pick<typeof notificationInbox, 'clear'>;
	identifyTelemetryUser: typeof identifyTelemetryUser;
	resetTelemetryIdentity: typeof resetTelemetryIdentity;
}

const defaultAuthStoreDependencies: AuthStoreDependencies = {
	client,
	getPasskeyAssertion,
	notificationInbox,
	identifyTelemetryUser,
	resetTelemetryIdentity
};

export function createAuthStore(
	dependencies: AuthStoreDependencies = defaultAuthStoreDependencies
) {
	const {
		client,
		getPasskeyAssertion,
		notificationInbox,
		identifyTelemetryUser,
		resetTelemetryIdentity
	} = dependencies;
	const { subscribe, set, update } = writable<AuthState>({
		user: null,
		isLoading: true,
		isAuthenticated: false
	});
	let activeUserID: string | null = null;
	const clearAccountState = () => {
		resetTelemetryIdentity();
		activeUserID = null;
		notificationInbox.clear();
		set({ user: null, isLoading: false, isAuthenticated: false });
	};
	const setAuthenticatedUser = (user: User | null) => {
		if (!user) {
			clearAccountState();
			return;
		}
		if (activeUserID !== user.id) notificationInbox.clear();
		activeUserID = user.id;
		set({ user, isLoading: false, isAuthenticated: true });
		identifyTelemetryUser(user.id);
	};

	return {
		subscribe,
		async initialize(options: { optional?: boolean } = {}) {
			if (!browser) return;

			try {
				if (options.optional) {
					const { data, error } = await client.GET('/auth/session-state');
					if (error || !data?.authenticated || !data.user) {
						clearAccountState();
						return;
					}
					setAuthenticatedUser(data.user);
					return;
				}
				const { data, error } = await client.GET('/auth/me');
				if (error || !data) throw new Error('Failed to fetch user');
				setAuthenticatedUser(data);
			} catch {
				clearAccountState();
			}
		},
		async login(email: string, password: string): Promise<AuthActionResult> {
			try {
				const { data, error } = await client.POST('/auth/login', {
					body: { email, password }
				});
				if (error || !data) throw new Error(error?.detail ?? 'Login failed');
				if (data.requires_mfa) {
					clearAccountState();
					return {
						success: false,
						requiresMfa: true,
						mfaToken: data.mfa_token,
						mfaMethods: data.mfa_methods ?? []
					};
				}
				if (data.requires_email_verification) {
					clearAccountState();
					return emailVerificationResult(data);
				}
				setAuthenticatedUser(data.user ?? null);
				return { success: true };
			} catch (e) {
				return { success: false, error: errorMessage(e) };
			}
		},
		async register({
			email,
			username,
			password,
			acceptedLegal,
			purchaseChoiceToken
		}: RegisterInput) {
			try {
				const { data, error } = await client.POST('/auth/register', {
					body: {
						email,
						username: username || undefined,
						password,
						accepted_legal: acceptedLegal,
						purchase_choice_token: purchaseChoiceToken
					}
				});
				if (error || !data) throw new Error(error?.detail || 'Registration failed');
				if (data.requires_email_verification) {
					clearAccountState();
					return emailVerificationResult(data);
				}
				setAuthenticatedUser(data.user ?? null);
				return { success: true };
			} catch (e) {
				return { success: false, error: errorMessage(e) };
			}
		},
		async verifyEmail(challengeID: string, code: string): Promise<AuthActionResult> {
			try {
				const { data, error } = await client.POST('/auth/email-verification/confirm', {
					body: { challenge_id: challengeID, code }
				});
				if (error || !data?.user) throw new Error(error?.detail ?? 'Email verification failed');
				setAuthenticatedUser(data.user);
				return { success: true };
			} catch (e) {
				return { success: false, error: errorMessage(e) };
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
				return { success: false, error: errorMessage(e) };
			}
		},
		async verifyTOTP(mfaToken: string, code: string): Promise<AuthActionResult> {
			try {
				const { data, error } = await client.POST('/auth/login/totp', {
					body: { mfa_token: mfaToken, code }
				});
				if (error || !data) throw new Error(error?.detail ?? 'Authenticator verification failed');
				setAuthenticatedUser(data.user ?? null);
				return { success: true };
			} catch (e) {
				return { success: false, error: errorMessage(e) };
			}
		},
		async verifyRecoveryCode(mfaToken: string, code: string): Promise<AuthActionResult> {
			try {
				const { data, error } = await client.POST('/auth/login/recovery-code', {
					body: { mfa_token: mfaToken, code }
				});
				if (error || !data) throw new Error(error?.detail ?? 'Recovery code verification failed');
				setAuthenticatedUser(data.user ?? null);
				return { success: true };
			} catch (e) {
				return { success: false, error: errorMessage(e) };
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

				setAuthenticatedUser(data.user ?? null);
				return { success: true };
			} catch (e) {
				return { success: false, error: errorMessage(e) };
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
			clearAccountState();
		},
		setUser(user: User | null) {
			if (user?.id === activeUserID) {
				update((state) => ({ ...state, user, isAuthenticated: true }));
				return;
			}
			setAuthenticatedUser(user);
		}
	};
}

export const auth = createAuthStore();

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

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
