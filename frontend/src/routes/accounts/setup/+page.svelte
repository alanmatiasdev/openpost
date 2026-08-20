<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import { client, type SocialAccount } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import AccountFeaturePresentation from '$lib/components/account-feature-presentation.svelte';
	import { m } from '$lib/paraglide/messages';
	import { formatAccountHandle, getPlatformName } from '$lib/utils';
	import {
		accountManagementReturnHref,
		clearAccountManagementContinuation,
		interpretAccountSetupURL
	} from '$lib/account-management-route';

	type Feature = components['schemas']['FeatureStateResponse'];

	let workspaceID = $state('');
	let accountIDs = $state<string[]>([]);
	let newAccountIDs = $state<string[]>([]);
	let openFreshComposer = $state(false);
	let loading = $state(true);
	let error = $state('');
	let features = $state<Feature[]>([]);
	let accounts = $state<SocialAccount[]>([]);
	let saving = $state(false);
	let saveError = $state('');
	let bypassing = $state(false);

	// selections keyed as `${accountId}:${feature}`
	let selections = $state<Record<string, boolean>>({});

	let offeredCount = $derived.by(() => {
		let count = 0;
		for (const f of features) {
			if (f.availability !== 'unsupported') count++;
		}
		return count;
	});

	let hasOffered = $derived(offeredCount > 0);

	function selectionKey(accountId: string, feature: string) {
		return `${accountId}:${feature}`;
	}

	function featuresForAccount(accountId: string): Feature[] {
		return features.filter((f) => f.social_account_id === accountId);
	}

	function offeredForAccount(accountId: string): Feature[] {
		return featuresForAccount(accountId).filter((f) => f.availability !== 'unsupported');
	}

	function accountDisplay(accountId: string): string {
		const acc = accounts.find((a) => a.id === accountId);
		if (acc) {
			const handle = formatAccountHandle(acc.account_username);
			if (handle) return handle;
			if (acc.account_username) return acc.account_username;
			return getPlatformName(acc.platform);
		}
		const f = features.find((x) => x.social_account_id === accountId);
		if (f) return getPlatformName(f.platform);
		return accountId.slice(0, 8);
	}

	function accountPlatform(accountId: string): string {
		const acc = accounts.find((a) => a.id === accountId);
		if (acc) return getPlatformName(acc.platform);
		const f = features.find((x) => x.social_account_id === accountId);
		if (f) return getPlatformName(f.platform);
		return 'Account';
	}

	onMount(async () => {
		const state = interpretAccountSetupURL(new URL(window.location.href));
		if (!state || !state.workspaceID) {
			error = m.account_setup_error_invalid();
			loading = false;
			return;
		}
		workspaceID = state.workspaceID.trim();
		accountIDs = state.accountIDs.map((s) => s.trim()).filter(Boolean);
		newAccountIDs = state.newAccountIDs.map((s) => s.trim()).filter(Boolean);
		openFreshComposer = state.openFreshComposer;

		if (!workspaceID || (newAccountIDs.length === 0 && accountIDs.length === 0)) {
			error = m.account_setup_error_invalid();
			loading = false;
			return;
		}

		const targetIDs = newAccountIDs.length ? newAccountIDs : accountIDs;
		if (targetIDs.length === 0) {
			error = m.account_setup_error_invalid();
			loading = false;
			return;
		}

		try {
			const [{ data: featData, error: featErr }, { data: accData }] = await Promise.all([
				client.GET('/account-features', {
					params: { query: { workspace_id: workspaceID, account_ids: targetIDs.join(',') } }
				}),
				client.GET('/accounts', { params: { query: { workspace_id: workspaceID } } })
			]);

			if (featErr) {
				const detail = featErr.detail ?? '';
				if (
					detail.toLowerCase().includes('does not belong') ||
					detail.toLowerCase().includes('not found')
				) {
					error = m.account_setup_error_workspace_mismatch();
				} else if (detail) {
					error = detail;
				} else {
					error = m.account_setup_error_load_failed();
				}
				loading = false;
				return;
			}

			features = featData ?? [];
			accounts = accData ?? [];

			// Validate that all target IDs belong to workspace and appear in features
			const seen = new Set(features.map((f) => f.social_account_id));
			for (const id of targetIDs) {
				if (!seen.has(id)) {
					error = m.account_setup_error_invalid();
					loading = false;
					return;
				}
			}

			// Initialize selections: every offered starts unchecked
			const next: Record<string, boolean> = {};
			for (const f of features) {
				if (f.availability === 'unsupported') continue;
				next[selectionKey(f.social_account_id, f.feature)] = false;
			}
			selections = next;

			// If no supported/actionable feature, bypass without empty step
			const offered = features.filter((f) => f.availability !== 'unsupported');
			if (offered.length === 0) {
				bypassing = true;
				continueFromSetup();
				return;
			}
		} catch (e) {
			console.error('setup load failed', e);
			error = m.account_setup_error_load_failed();
		} finally {
			loading = false;
		}
	});

	function continueFromSetup() {
		clearAccountManagementContinuation();
		if (openFreshComposer) {
			const q = new URLSearchParams({
				workspace_id: workspaceID,
				account_ids: accountIDs.join(',')
			});
			void goto(resolveAppPath(`/?${q.toString()}`));
		} else {
			void goto(resolveAppPath(accountManagementReturnHref()));
		}
	}

	async function saveChoices(overrides?: Record<string, boolean>) {
		saveError = '';
		saving = true;
		try {
			const effective = overrides ?? selections;
			const choices: Array<{
				account_id: string;
				feature: 'messaging' | 'engagement' | 'analytics' | 'grow';
				enabled: boolean;
				source?: string;
			}> = [];
			for (const f of features) {
				if (f.availability === 'unsupported') continue;
				const key = selectionKey(f.social_account_id, f.feature);
				const enabled = Boolean(effective[key]);
				choices.push({
					account_id: f.social_account_id,
					feature: f.feature,
					enabled,
					source: 'user_save'
				});
			}
			if (choices.length === 0) {
				continueFromSetup();
				return;
			}
			const { error: err } = await client.POST('/account-features', {
				body: { workspace_id: workspaceID, choices }
			});
			if (err) {
				saveError = err.detail ?? m.account_setup_error_load_failed();
				return;
			}
			continueFromSetup();
		} catch (e) {
			saveError = e instanceof Error ? e.message : m.account_setup_error_load_failed();
		} finally {
			saving = false;
		}
	}

	function handleToggle(accountId: string, feature: string, checked: boolean) {
		const key = selectionKey(accountId, feature);
		selections = { ...selections, [key]: checked };
	}

	function handleKeepAllOff() {
		const off: Record<string, boolean> = {};
		for (const f of features) {
			if (f.availability === 'unsupported') continue;
			off[selectionKey(f.social_account_id, f.feature)] = false;
		}
		selections = off;
		void saveChoices(off);
	}

	function handleSaveAndContinue() {
		void saveChoices();
	}

	function selectionsForAccount(accountId: string) {
		const map: Record<string, boolean> = {};
		for (const f of offeredForAccount(accountId)) {
			map[f.feature] = Boolean(selections[selectionKey(accountId, f.feature)]);
		}
		return map;
	}
</script>

<svelte:head>
	<title>{m.account_setup_title()} - OpenPost</title>
</svelte:head>

<StandaloneShell
	title={m.account_setup_heading()}
	description={m.account_setup_description()}
	loading={loading || bypassing}
	loadingLabel={m.common_loading()}
	maxWidth="lg"
>
	{#if error}
		<InlineNotice tone="error" message={error} />
		<div class="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<Button
				href={resolveAppPath(accountManagementReturnHref())}
				variant="outline"
				class="min-h-11 sm:min-h-9"
			>
				{m.account_setup_back_to_accounts()}
			</Button>
		</div>
	{:else if !loading && hasOffered}
		<div class="space-y-6">
			<p class="text-sm leading-6 text-muted-foreground">
				{m.account_setup_intro()}
			</p>

			{#each newAccountIDs.length ? newAccountIDs : accountIDs as accountId (accountId)}
				{@const offered = offeredForAccount(accountId)}
				{#if offered.length > 0}
					<section
						class="space-y-3 rounded-lg border bg-muted/20 p-3 sm:p-4"
						aria-labelledby={`account-heading-${accountId}`}
					>
						<div class="flex items-center gap-2">
							<h2 id={`account-heading-${accountId}`} class="text-sm font-semibold tracking-tight">
								{m.account_setup_account_heading({
									platform: accountPlatform(accountId),
									name: accountDisplay(accountId)
								})}
							</h2>
						</div>
						<AccountFeaturePresentation
							{accountId}
							features={featuresForAccount(accountId)}
							selections={selectionsForAccount(accountId)}
							mode="setup"
							busy={saving}
							onToggle={(feature, checked) => handleToggle(accountId, feature, checked)}
						/>
					</section>
				{/if}
			{/each}

			<div class="rounded-md border bg-card p-3 text-xs leading-5 text-muted-foreground">
				{m.account_setup_provider_auth_note()}
			</div>

			{#if saveError}
				<InlineNotice tone="error" message={saveError} />
			{/if}

			<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Button
					variant="outline"
					onclick={handleKeepAllOff}
					disabled={saving}
					class="min-h-11 sm:min-h-9"
				>
					{m.account_setup_keep_all_off()}
				</Button>
				<Button onclick={handleSaveAndContinue} disabled={saving} class="min-h-11 sm:min-h-9">
					{saving ? m.account_setup_saving() : m.account_setup_continue()}
				</Button>
			</div>
		</div>
	{:else if !loading && !hasOffered}
		<p class="text-sm text-muted-foreground">{m.account_setup_bypass_note()}</p>
	{/if}
</StandaloneShell>
