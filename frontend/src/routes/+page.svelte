<script lang="ts">
	import ComposeShell from '$lib/components/compose-shell.svelte';
	import WorkspaceSetupGuide from '$lib/components/workspace-setup-guide.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
</script>

<svelte:head>
	<title>OpenPost</title>
</svelte:head>

<div class="flex flex-1 flex-col overflow-hidden">
	{#if workspaceCtx.currentWorkspace}
		<div class="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6 lg:px-8">
			<WorkspaceSetupGuide workspaceID={workspaceCtx.currentWorkspace.id} />
		</div>
	{/if}
	<ComposeShell />
</div>
