<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { client, type SocialAccount } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import AppSelect from './app-select.svelte';
	import DestructiveConfirmDialog from './destructive-confirm-dialog.svelte';
	import InlineNotice from './inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import Settings2Icon from 'lucide-svelte/icons/settings-2';
	import Trash2Icon from 'lucide-svelte/icons/trash-2';
	import { getPlatformKey, getPlatformName } from '$lib/utils';
	import { m } from '$lib/paraglide/messages';

	type SocialSet = components['schemas']['SocialSetResponse'];
	type Capability = components['schemas']['Capability'];
	type SocialSetAccountInput = components['schemas']['SocialSetAccountInput'];

	interface Props {
		workspaceId: string;
		accounts: SocialAccount[];
		capabilities: Capability[];
		selectedSetId?: string;
		disabled?: boolean;
		autoApplyDefault?: boolean;
		onApply: (set: SocialSet | null) => void;
	}

	let {
		workspaceId,
		accounts,
		capabilities,
		selectedSetId = $bindable(''),
		disabled = false,
		autoApplyDefault = false,
		onApply
	}: Props = $props();

	let sets = $state<SocialSet[]>([]);
	let loading = $state(false);
	let error = $state('');
	let manageOpen = $state(false);
	let editorId = $state('');
	let editorName = $state('');
	let editorDefault = $state(false);
	let editorAccountIds = $state<string[]>([]);
	let editorFormats = $state<Record<string, string>>({});
	let saving = $state(false);
	let deleting = $state(false);
	let deleteOpen = $state(false);
	let loadedWorkspaceId = '';

	const options = $derived([
		{ value: '', label: m.social_set_custom_selection() },
		...(selectedSetId && !sets.some((set) => set.id === selectedSetId)
			? [{ value: selectedSetId, label: m.social_set_removed_snapshot() }]
			: []),
		...sets.map((set) => ({
			value: set.id,
			label: set.is_default ? m.social_set_default_label({ name: set.name }) : set.name
		}))
	]);

	onMount(() => {
		if (workspaceId) void loadSets();
	});

	$effect(() => {
		if (workspaceId && workspaceId !== loadedWorkspaceId) void loadSets();
	});

	async function loadSets() {
		const requestedWorkspace = workspaceId;
		if (!requestedWorkspace) return;
		loadedWorkspaceId = requestedWorkspace;
		loading = true;
		error = '';
		const { data, error: loadError } = await client.GET('/social-sets', {
			params: { query: { workspace_id: requestedWorkspace } }
		});
		if (workspaceId !== requestedWorkspace) return;
		loading = false;
		if (loadError) {
			error = loadError.detail || m.social_set_load_failed();
			return;
		}
		sets = data ?? [];
		if (selectedSetId) {
			// The publication already owns a destination snapshot. Loading the
			// reusable set must never replace that snapshot with current membership.
			return;
		}
		if (autoApplyDefault) {
			const defaultSet = sets.find((set) => set.is_default) ?? null;
			if (defaultSet) {
				selectedSetId = defaultSet.id;
				onApply(defaultSet);
			}
		}
	}

	function selectSet(id: string) {
		selectedSetId = id;
		onApply(sets.find((set) => set.id === id) ?? null);
	}

	function startNewSet() {
		editorId = '';
		editorName = '';
		editorDefault = sets.length === 0;
		editorAccountIds = accounts.map((account) => account.id);
		editorFormats = {};
	}

	function startEditing(set: SocialSet) {
		editorId = set.id;
		editorName = set.name;
		editorDefault = set.is_default;
		editorAccountIds = (set.accounts ?? []).map((account) => account.social_account_id);
		editorFormats = Object.fromEntries(
			(set.accounts ?? []).map((account) => [
				account.social_account_id,
				account.default_output_profile ?? ''
			])
		);
	}

	function toggleEditorAccount(accountId: string) {
		editorAccountIds = editorAccountIds.includes(accountId)
			? editorAccountIds.filter((id) => id !== accountId)
			: [...editorAccountIds, accountId];
	}

	function formatOptions(account: SocialAccount) {
		const provider = getPlatformKey(account.platform);
		const unique = new SvelteMap<string, string>();
		for (const capability of capabilities) {
			if (capability.provider !== provider || !capability.output_profile) continue;
			unique.set(capability.output_profile, capability.label);
		}
		return [
			{ value: '', label: m.social_set_format_automatic() },
			...Array.from(unique, ([value, label]) => ({ value, label }))
		];
	}

	function editorAccounts(): SocialSetAccountInput[] {
		return editorAccountIds.map((accountId) => ({
			social_account_id: accountId,
			...(editorFormats[accountId] ? { default_output_profile: editorFormats[accountId] } : {})
		}));
	}

	async function saveSet() {
		if (!editorName.trim() || saving) return;
		const creating = !editorId;
		saving = true;
		error = '';
		try {
			if (editorId) {
				const { error: saveError } = await client.PUT('/social-sets/{id}', {
					params: { path: { id: editorId } },
					body: {
						name: editorName.trim(),
						is_default: editorDefault,
						accounts: editorAccounts()
					}
				});
				if (saveError) throw new Error(saveError.detail || m.social_set_save_failed());
			} else {
				const { data, error: saveError } = await client.POST('/social-sets', {
					body: {
						workspace_id: workspaceId,
						name: editorName.trim(),
						is_default: editorDefault,
						accounts: editorAccounts()
					}
				});
				if (saveError) throw new Error(saveError.detail || m.social_set_save_failed());
				editorId = data.id;
				selectedSetId = data.id;
			}
			await loadSets();
			const saved = sets.find((set) => set.id === editorId) ?? null;
			if (creating && saved) onApply(saved);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.social_set_save_failed();
		} finally {
			saving = false;
		}
	}

	async function deleteSet() {
		if (!editorId || deleting) return;
		deleting = true;
		error = '';
		try {
			const { error: deleteError } = await client.DELETE('/social-sets/{id}', {
				params: { path: { id: editorId }, query: { confirm: true } }
			});
			if (deleteError) throw new Error(deleteError.detail || m.social_set_delete_failed());
			if (selectedSetId === editorId) {
				selectedSetId = '';
				onApply(null);
			}
			deleteOpen = false;
			startNewSet();
			await loadSets();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.social_set_delete_failed();
		} finally {
			deleting = false;
		}
	}

	function accountLabel(account: SocialAccount) {
		return account.account_username || account.slug || getPlatformName(account.platform);
	}

	function handleManageOpenChange(next: boolean) {
		manageOpen = next;
		if (!next) return;
		if (selectedSetId) {
			const selected = sets.find((set) => set.id === selectedSetId);
			if (selected) {
				startEditing(selected);
				return;
			}
		}
		startNewSet();
	}
</script>

<div class="flex min-w-0 items-center gap-1.5" data-testid="social-set-control">
	<AppSelect
		value={selectedSetId}
		{options}
		placeholder={m.social_set_select()}
		ariaLabel={m.social_set_select()}
		class="h-11 min-w-40 md:h-8 md:max-w-56"
		disabled={disabled || loading}
		onValueChange={selectSet}
	/>
	<Dialog.Root bind:open={manageOpen} onOpenChange={handleManageOpenChange}>
		<Dialog.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					type="button"
					variant="ghost"
					size="icon"
					class="size-11 md:size-8"
					aria-label={m.social_set_manage()}
					{disabled}
				>
					<Settings2Icon class="size-4" />
				</Button>
			{/snippet}
		</Dialog.Trigger>
		<Dialog.Content class="max-h-[min(44rem,90dvh)] overflow-y-auto sm:max-w-2xl">
			<Dialog.Header>
				<Dialog.Title>{m.social_set_manage()}</Dialog.Title>
				<Dialog.Description>{m.social_set_description()}</Dialog.Description>
			</Dialog.Header>

			{#if error}
				<InlineNotice tone="error" message={error} />
			{/if}

			<div class="grid gap-5 md:grid-cols-[12rem_minmax(0,1fr)]">
				<nav class="space-y-1" aria-label={m.social_set_manage()}>
					{#each sets as set (set.id)}
						<Button
							type="button"
							variant={editorId === set.id ? 'secondary' : 'ghost'}
							class="h-auto min-h-11 w-full justify-start px-3 py-2 text-left"
							onclick={() => startEditing(set)}
						>
							<span class="min-w-0 truncate">{set.name}</span>
							{#if set.is_default}
								<span class="ml-auto text-xs text-muted-foreground">{m.social_set_default()}</span>
							{/if}
						</Button>
					{/each}
					<Button type="button" variant="outline" class="mt-2 h-11 w-full" onclick={startNewSet}>
						{m.social_set_new()}
					</Button>
				</nav>

				<div class="min-w-0 space-y-5">
					<div class="space-y-2">
						<Label for="social-set-name">{m.social_set_name()}</Label>
						<Input id="social-set-name" bind:value={editorName} maxlength={80} />
					</div>
					<label class="flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-sm">
						<Checkbox bind:checked={editorDefault} />
						<span>{m.social_set_use_default()}</span>
					</label>

					<fieldset class="space-y-2">
						<legend class="text-sm font-medium">{m.social_set_accounts()}</legend>
						{#each accounts as account (account.id)}
							<div class="rounded-md border px-3 py-2.5">
								<label class="flex min-h-8 items-center gap-3 text-sm">
									<Checkbox
										checked={editorAccountIds.includes(account.id)}
										onCheckedChange={() => toggleEditorAccount(account.id)}
									/>
									<span class="min-w-0 truncate font-medium">{accountLabel(account)}</span>
									<span class="ml-auto text-xs text-muted-foreground">
										{getPlatformName(account.platform)}
									</span>
								</label>
								{#if editorAccountIds.includes(account.id)}
									<div class="mt-2 pl-7">
										<AppSelect
											value={editorFormats[account.id] ?? ''}
											options={formatOptions(account)}
											ariaLabel={m.social_set_default_format({ account: accountLabel(account) })}
											onValueChange={(value) =>
												(editorFormats = { ...editorFormats, [account.id]: value })}
										/>
									</div>
								{/if}
							</div>
						{/each}
					</fieldset>
				</div>
			</div>

			<Dialog.Footer class="gap-2 sm:justify-between">
				<div>
					{#if editorId}
						<Button
							type="button"
							variant="ghost"
							class="h-11 gap-2 text-destructive"
							onclick={() => (deleteOpen = true)}
						>
							<Trash2Icon class="size-4" />
							{m.common_delete()}
						</Button>
					{/if}
				</div>
				<Button
					type="button"
					class="h-11"
					disabled={!editorName.trim() || saving}
					onclick={saveSet}
				>
					{saving ? m.common_saving() : m.common_save()}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
</div>

<DestructiveConfirmDialog
	bind:open={deleteOpen}
	title={m.social_set_delete_title()}
	description={m.social_set_delete_description()}
	confirmLabel={m.common_delete()}
	onConfirm={deleteSet}
/>
