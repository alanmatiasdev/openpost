<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import PageContainer from '$lib/components/page-container.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import { Button } from '$lib/components/ui/button';
	import BellIcon from 'lucide-svelte/icons/bell';
	import TrashIcon from 'lucide-svelte/icons/trash-2';
	import CheckIcon from 'lucide-svelte/icons/check-check';
	import SettingsIcon from 'lucide-svelte/icons/settings-2';

	type Notification = components['schemas']['UserNotification'];
	type NotificationAction = NonNullable<Notification['actions']>[number];
	let loading = $state(true);
	let error = $state('');
	let notifications = $state.raw<Notification[]>([]);
	let unreadCount = $state(0);
	let loadedWorkspace = $state('');
	let toast = $state('');
	let toastTone = $state<'success' | 'error'>('success');
	let deleteDialogOpen = $state(false);
	let actionPending = $state('');

	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');

	onMount(() => void workspaceCtx.initialize());

	$effect(() => {
		if (workspaceId && workspaceId !== loadedWorkspace) {
			loadedWorkspace = workspaceId;
			void load();
		}
	});

	async function load() {
		if (!workspaceId) return;
		loading = true;
		error = '';
		const requestedWorkspace = workspaceId;
		const notificationResponse = await client.GET('/notifications', {
			params: { query: { workspace_id: requestedWorkspace, limit: 100 } }
		});
		if (workspaceId !== requestedWorkspace) return;
		if (notificationResponse.error) {
			error = notificationResponse.error.detail || m.notifications_load_failed();
		} else {
			notifications = notificationResponse.data?.items ?? [];
			unreadCount = notificationResponse.data?.unread_count ?? 0;
		}
		loading = false;
	}

	async function markAllRead() {
		const { error: apiError } = await client.POST('/notifications/read', {
			body: { all: true }
		});
		if (apiError) {
			showToast(m.notifications_load_failed(), 'error');
			return;
		}
		const now = new Date().toISOString();
		notifications = notifications.map((notification) => ({ ...notification, read_at: now }));
		unreadCount = 0;
	}

	async function deleteAll() {
		const { error: apiError } = await client.POST('/notifications/delete', {
			body: { all: true }
		});
		if (apiError) {
			showToast(m.notifications_load_failed(), 'error');
			return;
		}
		notifications = [];
		unreadCount = 0;
	}

	async function openNotification(notification: Notification) {
		if (!notification.read_at) {
			await client.POST('/notifications/read', { body: { ids: [notification.id] } });
			notifications = notifications.map((item) =>
				item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item
			);
			unreadCount = Math.max(0, unreadCount - 1);
		}
		if (notification.href.startsWith('/')) {
			await goto(resolve(notification.href as '/'));
		}
	}

	async function runNotificationAction(notification: Notification, action: NotificationAction) {
		actionPending = `${notification.id}:${action.label}`;
		try {
			if (action.operation === 'retry_failed_publication' && action.target_id) {
				const { error: apiError } = await client.POST('/publications/{id}/retry-failed', {
					params: { path: { id: action.target_id } }
				});
				if (apiError) {
					showToast(apiError.detail || m.notifications_action_failed(), 'error');
					return;
				}
				showToast(m.notifications_retry_queued(), 'success');
				await openNotification(notification);
				await load();
				return;
			}
			if (action.href?.startsWith('/')) {
				await openNotification({ ...notification, href: action.href });
			}
		} finally {
			actionPending = '';
		}
	}

	function showToast(message: string, tone: 'success' | 'error') {
		toast = message;
		toastTone = tone;
	}

	function dateLabel(value: string) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(date);
	}
</script>

<svelte:head>
	<title>{m.notifications_heading()} · OpenPost</title>
</svelte:head>

{#if toast}
	<AppToast
		message={toast}
		tone={toastTone}
		dismissLabel={m.common_dismiss()}
		onDismiss={() => (toast = '')}
	/>
{/if}

<PageContainer
	title={m.notifications_heading()}
	description={m.notifications_description()}
	icon={BellIcon}
	{loading}
	loadingLayout="list"
	loadingItems={6}
>
	{#snippet actions()}
		<div class="flex flex-wrap gap-2">
			<Button
				variant="outline"
				onclick={() => void goto(resolve('/settings?tab=notifications' as '/'))}
			>
				<SettingsIcon class="size-4" />{m.notifications_open_settings()}
			</Button>
			<Button variant="outline" onclick={() => void markAllRead()} disabled={unreadCount === 0}>
				<CheckIcon class="size-4" />{m.notifications_mark_all_read()}
			</Button>
		</div>
	{/snippet}

	<div class="space-y-8">
		{#if error}
			<InlineNotice tone="error" message={error} />
		{:else if notifications.length === 0}
			<EmptyState
				icon={BellIcon}
				title={m.notifications_empty_title()}
				description={m.notifications_empty_description()}
				variant="muted"
			/>
		{:else}
			<section aria-label={m.notifications_heading()}>
				<div class="mb-3 flex items-center justify-between">
					<p class="text-sm text-muted-foreground">
						{m.notifications_unread_count({ count: unreadCount })}
					</p>
					<Button
						variant="ghost"
						size="sm"
						class="text-destructive"
						onclick={() => (deleteDialogOpen = true)}
					>
						<TrashIcon class="size-4" />{m.notifications_delete_all()}
					</Button>
				</div>
				<div class="divide-y rounded-lg border bg-card">
					{#each notifications as notification (notification.id)}
						<article
							class={[
								'flex min-h-20 w-full items-start gap-3 p-4',
								!notification.read_at && 'bg-primary/[0.025]'
							]}
						>
							<span
								class={[
									'mt-1 size-2 shrink-0 rounded-full',
									notification.read_at ? 'bg-transparent' : 'bg-primary'
								]}
								aria-hidden="true"
							></span>
							<div class="min-w-0 flex-1">
								<button
									type="button"
									class="w-full rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
									onclick={() => void openNotification(notification)}
								>
									<span class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
										<span class="text-sm font-semibold">{notification.title}</span>
										<span class="text-xs text-muted-foreground">
											{dateLabel(notification.created_at)}
										</span>
									</span>
									{#if notification.body}
										<span class="mt-1 block text-sm leading-5 text-muted-foreground">
											{notification.body}
										</span>
									{/if}
								</button>
								{#if notification.actions?.length}
									<div class="mt-3 flex flex-wrap gap-2">
										{#each notification.actions as action (`${action.label}:${action.href}:${action.operation}`)}
											<Button
												variant={action.kind === 'primary' ? 'default' : 'outline'}
												size="sm"
												disabled={actionPending !== ''}
												onclick={() => void runNotificationAction(notification, action)}
											>
												{action.label}
											</Button>
										{/each}
									</div>
								{/if}
							</div>
						</article>
					{/each}
				</div>
			</section>
		{/if}
	</div>
</PageContainer>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={m.notifications_delete_all_confirm_title()}
	description={m.notifications_delete_all_confirm_description()}
	confirmLabel={m.notifications_delete_all()}
	onConfirm={deleteAll}
/>
