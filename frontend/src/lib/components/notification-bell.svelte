<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { client } from '$lib/api/client';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import BellIcon from 'lucide-svelte/icons/bell';

	let { compact = false }: { compact?: boolean } = $props();
	let unreadCount = $state(0);
	let loadedWorkspace = $state('');
	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');

	async function loadUnread() {
		if (!workspaceId) {
			unreadCount = 0;
			return;
		}
		const requestedWorkspace = workspaceId;
		const { data } = await client.GET('/notifications', {
			params: { query: { workspace_id: requestedWorkspace, limit: 1 } }
		});
		if (workspaceId === requestedWorkspace) unreadCount = data?.unread_count ?? 0;
	}

	onMount(() => void loadUnread());

	$effect(() => {
		if (workspaceId && workspaceId !== loadedWorkspace) {
			loadedWorkspace = workspaceId;
			void loadUnread();
		}
	});
</script>

{#if compact}
	<a
		href={resolve('/notifications' as '/')}
		class="relative inline-flex size-8 items-center justify-center rounded-md text-sidebar-foreground/62 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
		aria-label={m.notifications_heading()}
		title={m.notifications_heading()}
		data-testid="sidebar-notifications"
	>
		<BellIcon class="size-4" />
		{#if unreadCount > 0}
			<span
				class="absolute end-1 top-1 size-1.5 rounded-full bg-primary ring-2 ring-sidebar"
				aria-hidden="true"
			></span>
			<span class="sr-only">{m.notifications_unread_count({ count: unreadCount })}</span>
		{/if}
	</a>
{:else}
	<Sidebar.MenuItem>
		<Sidebar.MenuButton class="relative h-10 text-sm" tooltipContent={m.notifications_heading()}>
			{#snippet child({ props })}
				<a {...props} href={resolve('/notifications' as '/')}>
					<BellIcon class="size-4" />
					<span>{m.notifications_heading()}</span>
					{#if unreadCount > 0}
						<span
							class="ms-auto min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[10px] font-semibold text-primary-foreground"
							aria-label={m.notifications_unread_count({ count: unreadCount })}
						>
							{unreadCount > 99 ? '99+' : unreadCount}
						</span>
					{/if}
				</a>
			{/snippet}
		</Sidebar.MenuButton>
	</Sidebar.MenuItem>
{/if}
