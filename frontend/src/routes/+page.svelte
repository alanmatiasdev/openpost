<script lang="ts">
	import ComposeShell from '$lib/components/compose-shell.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import WorkspaceSetupGuide from '$lib/components/workspace-setup-guide.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';

	let handoffSelected = $state(false);
</script>

<svelte:head>
	<title>OpenPost</title>
</svelte:head>

<div class="flex flex-1 flex-col overflow-hidden">
	{#if workspaceCtx.currentWorkspace}
		<WorkspaceSetupGuide
			workspaceID={workspaceCtx.currentWorkspace.id}
			wrapperClass="mx-auto hidden w-full max-w-6xl px-4 pt-5 md:block lg:px-8"
		/>
	{/if}
	{#if handoffSelected}
		<div class="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6 lg:px-8">
			<InlineNotice
				tone="success"
				message={m.accounts_callback_composer_selection_success()}
				class="mb-4"
			/>
		</div>
	{/if}
	<ComposeShell onHandoffSelected={() => (handoffSelected = true)} />
</div>
