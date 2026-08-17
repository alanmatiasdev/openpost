<script lang="ts">
	import type { components } from '$lib/api/types';
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Label } from '$lib/components/ui/label';
	import { m } from '$lib/paraglide/messages';

	type InstanceUser = components['schemas']['InstanceUserResponse'];

	interface Props {
		open: boolean;
		user: InstanceUser | null;
		onOpenChange: (open: boolean) => void;
		onPlanChanged: () => void;
	}

	const planOptions = [
		{
			value: 'starter',
			label: m.settings_plan_starter(),
			description: m.settings_plan_starter_description()
		},
		{
			value: 'founder',
			label: m.settings_plan_founder(),
			description: m.settings_plan_founder_description()
		},
		{
			value: 'pro',
			label: m.settings_plan_pro(),
			description: m.settings_plan_pro_description()
		},
		{
			value: 'team',
			label: m.settings_plan_team(),
			description: m.settings_plan_team_description()
		},
		{
			value: 'agency',
			label: m.settings_plan_agency(),
			description: m.settings_plan_agency_description()
		}
	];

	let { open, user, onOpenChange, onPlanChanged }: Props = $props();

	let selectedPlan = $state('');
	let saving = $state(false);
	let error = $state('');
	let success = $state(false);

	const currentPlanIDs = $derived(user?.plan_ids ?? []);
	const currentPlan = $derived(currentPlanIDs.length > 0 ? currentPlanIDs[0] : '');
	const selectedPlanLabel = $derived(
		planOptions.find((p) => p.value === selectedPlan)?.label ??
			m.settings_instance_select_plan_placeholder()
	);

	function handleOpenChange(isOpen: boolean) {
		if (!isOpen) {
			selectedPlan = '';
			saving = false;
			error = '';
			success = false;
		}
		onOpenChange(isOpen);
	}

	async function savePlan() {
		if (!user || !selectedPlan) return;

		saving = true;
		error = '';
		success = false;

		const { error: apiError } = await (
			await import('$lib/api/client')
		).client.PUT('/admin/users/{user_id}/plan', {
			params: { path: { user_id: user.id } },
			body: { plan_id: selectedPlan }
		});

		saving = false;
		if (apiError) {
			error = apiError.detail?.trim() || m.settings_instance_change_plan_failed();
			return;
		}

		success = true;
		setTimeout(() => {
			handleOpenChange(false);
			onPlanChanged();
		}, 1000);
	}

	async function removePlan() {
		if (!user) return;

		saving = true;
		error = '';
		success = false;

		const { error: apiError } = await (
			await import('$lib/api/client')
		).client.PUT('/admin/users/{user_id}/plan', {
			params: { path: { user_id: user.id } },
			body: { plan_id: '' }
		});

		saving = false;
		if (apiError) {
			error = apiError.detail?.trim() || m.settings_instance_change_plan_failed();
			return;
		}

		success = true;
		setTimeout(() => {
			handleOpenChange(false);
			onPlanChanged();
		}, 1000);
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>
				{m.settings_instance_change_plan_title({
					user: user?.display_name?.trim() || user?.email || ''
				})}
			</Dialog.Title>
			<Dialog.Description>{m.settings_instance_change_plan_body()}</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4">
			{#if currentPlan}
				<div class="flex items-center gap-2">
					<span class="text-sm text-muted-foreground">{m.settings_instance_current_plan()}:</span>
					<Badge class="border-primary/15 bg-primary/10 text-primary">
						{planOptions.find((p) => p.value === currentPlan)?.label || currentPlan}
					</Badge>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">
					{m.settings_instance_no_plan_assigned()}
				</p>
			{/if}

			<div class="space-y-2">
				<Label for="plan-select">{m.settings_instance_select_plan()}</Label>
				<Select.Root type="single" bind:value={selectedPlan}>
					<Select.Trigger id="plan-select" class="w-full">
						{selectedPlanLabel}
					</Select.Trigger>
					<Select.Content>
						{#each planOptions as plan (plan.value)}
							<Select.Item value={plan.value} label={plan.label}>
								<div class="flex flex-col">
									<span>{plan.label}</span>
									<span class="text-xs text-muted-foreground">{plan.description}</span>
								</div>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			{#if error}
				<InlineNotice tone="error" message={error} />
			{/if}

			{#if success}
				<div class="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
					<CheckIcon class="size-4" />
					{m.settings_instance_plan_changed()}
				</div>
			{/if}
		</div>

		<Dialog.Footer class="gap-2 sm:gap-0">
			{#if currentPlan}
				<Button
					variant="destructive"
					onclick={removePlan}
					disabled={saving || success}
					class="mr-auto"
				>
					{#if saving}
						<LoaderIcon class="size-4 animate-spin" />
					{/if}
					{m.settings_instance_remove_plan()}
				</Button>
			{/if}
			<Button variant="outline" onclick={() => handleOpenChange(false)} disabled={saving}>
				{m.common_cancel()}
			</Button>
			<Button onclick={savePlan} disabled={!selectedPlan || saving || success}>
				{#if saving}
					<LoaderIcon class="size-4 animate-spin" />
				{/if}
				{m.settings_instance_apply_plan()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
