<!--
Video Editor workspace for one project. Phase 1 shell: project chrome and
load lifecycle. Timeline, preview, and tools land with the next phases.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import Logo from '$lib/components/Logo.svelte';
	import { getProject } from '$lib/video-editor/workspace-fs/projects';
	import type { Project } from '$lib/video-editor/project/types';
	import FolderIcon from '@lucide/svelte/icons/folder-open';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';

	let project = $state.raw<Project | null>(null);
	let loading = $state(true);
	let loadError = $state('');

	$effect(() => {
		const projectId = page.params.id;
		if (!projectId) return;
		loading = true;
		loadError = '';
		void (async () => {
			try {
				const loaded = await getProject(projectId);
				if (!loaded) {
					loadError = m.video_editor_project_missing();
				} else {
					project = loaded;
				}
			} catch {
				loadError = m.video_editor_project_load_failed();
			} finally {
				loading = false;
			}
		})();
	});
</script>

<svelte:head>
	<title>{project?.name ?? m.video_editor_title()}</title>
</svelte:head>

<div class="flex min-h-dvh flex-col bg-[oklch(0.145_0.008_55)] text-[oklch(0.92_0.005_85)]">
	<header
		class="flex items-center justify-between border-b border-[oklch(0.25_0.015_55)] px-4 py-2"
	>
		<a
			href="/video-editor"
			class="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
		>
			<Logo class="h-5 w-auto" />
			<span class="text-sm font-semibold">{m.video_editor_title()}</span>
		</a>
		{#if project}
			<span class="truncate px-2 text-sm font-medium">{project.name}</span>
		{/if}
	</header>

	<main class="flex flex-1 items-center justify-center px-4 py-10">
		{#if loading}
			<LoaderIcon class="size-6 animate-spin text-[oklch(0.65_0.015_55)]" aria-hidden="true" />
			<span class="sr-only">{m.editors_loading()}</span>
		{:else if loadError}
			<div class="text-center">
				<p class="text-sm text-[oklch(0.65_0.015_55)]">{loadError}</p>
				<Button class="mt-4" variant="outline" href="/video-editor"
					>{m.video_editor_go_back()}</Button
				>
			</div>
		{:else if project}
			<div class="flex items-center gap-2 text-sm text-[oklch(0.65_0.015_55)]">
				<FolderIcon class="size-4" aria-hidden="true" />
				<span>{project.id}</span>
			</div>
		{/if}
	</main>
</div>
