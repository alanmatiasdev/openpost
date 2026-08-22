<!--
Local-first OpenPost Video Editor entry.
OWN-WORLD: dark editing chrome over OpenPost warm neutrals; the workspace folder on disk is the source of truth.
STORY: pick (or reconnect) a workspace folder once, then work with projects that never leave the machine.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import { showToast } from '$lib/toast';
	import { createWorkspaceGate } from '$lib/video-editor/gate/workspace-gate.svelte';
	import {
		createProject,
		deleteProject,
		getAllProjects,
		updateProject
	} from '$lib/video-editor/workspace-fs/projects';
	import { softDeleteProject } from '$lib/video-editor/workspace-fs/trash';
	import { onPermissionLost } from '$lib/video-editor/workspace-fs/root';
	import type { Project } from '$lib/video-editor/project/types';
	import FolderIcon from '@lucide/svelte/icons/folder-open';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { onMount } from 'svelte';

	const gate = createWorkspaceGate();

	let projects = $state.raw<Project[]>([]);
	let loadingProjects = $state(false);
	let projectsError = $state('');
	let creating = $state(false);
	let newProjectName = $state('');
	let showNewProject = $state(false);
	let pendingDelete = $state<Project | null>(null);
	let deleteDialogOpen = $state(false);

	async function loadProjects(): Promise<void> {
		if (gate.state !== 'ready') return;
		loadingProjects = true;
		projectsError = '';
		try {
			projects = await getAllProjects();
		} catch (err) {
			projectsError = err instanceof Error ? err.message : String(err);
		} finally {
			loadingProjects = false;
		}
	}

	$effect(() => {
		if (gate.state === 'ready') void loadProjects();
	});

	onMount(() =>
		onPermissionLost(() => {
			showToast(m.video_editor_gate_permission_lost());
		})
	);

	function openProject(project: Project): void {
		void goto(`/video-editor/${project.id}`);
	}

	async function handleCreateProject(): Promise<void> {
		if (creating) return;
		creating = true;
		try {
			const { createBlankProject } = await import('$lib/video-editor/project/defaults');
			const project = createBlankProject(newProjectName.trim() || 'Untitled project');
			await createProject(project);
			newProjectName = '';
			showNewProject = false;
			await loadProjects();
			openProject(project);
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		} finally {
			creating = false;
		}
	}

	async function handleRename(project: Project): Promise<void> {
		const name = window.prompt(m.video_editor_project_rename_prompt(), project.name);
		if (name === null) return;
		const trimmed = name.trim();
		if (!trimmed || trimmed === project.name) return;
		try {
			await updateProject(project.id, { name: trimmed });
			await loadProjects();
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		}
	}

	function confirmDelete(project: Project): void {
		pendingDelete = project;
		deleteDialogOpen = true;
	}

	async function handleDelete(): Promise<void> {
		if (!pendingDelete) return;
		try {
			await softDeleteProject(pendingDelete.id);
			await deleteProject(pendingDelete.id).catch(() => undefined);
			await loadProjects();
			showToast(m.video_editor_project_deleted(), 'success');
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		} finally {
			pendingDelete = null;
			deleteDialogOpen = false;
		}
	}
</script>

<svelte:head>
	<title>{m.video_editor_title()}</title>
</svelte:head>

<div class="flex min-h-dvh flex-col bg-[oklch(0.145_0.008_55)] text-[oklch(0.92_0.005_85)]">
	<header
		class="flex items-center justify-between border-b border-[oklch(0.25_0.015_55)] px-4 py-2"
	>
		<a
			href="/editors"
			class="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
		>
			<Logo class="h-5 w-auto" />
			<span class="text-sm font-semibold">{m.video_editor_title()}</span>
		</a>
		{#if gate.state === 'ready'}
			<span class="hidden items-center gap-1.5 text-xs text-[oklch(0.65_0.015_55)] sm:flex">
				<FolderIcon class="size-3.5" aria-hidden="true" />
				{gate.workspaceName}
			</span>
		{/if}
	</header>

	<main class="flex flex-1 flex-col items-center justify-center px-4 py-10">
		{#if gate.state === 'initializing'}
			<PageLoading label={m.editors_loading()} />
		{:else if gate.state === 'unavailable'}
			<div class="max-w-md text-center">
				<h1 class="text-lg font-semibold">{m.video_editor_gate_unavailable_title()}</h1>
				<p class="mt-2 text-sm text-[oklch(0.65_0.015_55)]">
					{m.video_editor_gate_unavailable_body()}
				</p>
				<Button class="mt-6" onclick={() => history.back()}>{m.video_editor_go_back()}</Button>
			</div>
		{:else if gate.state === 'pick' || gate.state === 'reconnect'}
			<div
				class="w-full max-w-md rounded-xl border border-[oklch(0.25_0.015_55)] bg-[oklch(0.2_0.01_50)] p-8 text-center"
			>
				<FolderPlusIcon class="mx-auto size-10 text-[oklch(0.66_0.14_45)]" aria-hidden="true" />
				<h1 class="mt-4 text-lg font-semibold">
					{gate.state === 'pick'
						? m.video_editor_gate_pick_title()
						: m.video_editor_gate_reconnect_title()}
				</h1>
				<p class="mt-2 text-sm text-[oklch(0.65_0.015_55)]">
					{gate.state === 'pick'
						? m.video_editor_gate_pick_body()
						: m.video_editor_gate_reconnect_body({ folder: gate.workspaceName })}
				</p>
				{#if gate.error}
					<InlineNotice tone="error" class="mt-4 text-left">{gate.error}</InlineNotice>
				{/if}
				<div class="mt-6 flex flex-col items-center gap-2">
					{#if gate.state === 'pick'}
						<Button onclick={() => gate.pickFolder()} disabled={gate.busy}>
							{#if gate.busy}
								<LoaderIcon class="size-4 animate-spin" aria-hidden="true" />
							{:else}
								<FolderPlusIcon class="size-4" aria-hidden="true" />
							{/if}
							{m.video_editor_gate_pick_cta()}
						</Button>
					{:else}
						<Button onclick={() => gate.reconnect()} disabled={gate.busy}>
							{#if gate.busy}
								<LoaderIcon class="size-4 animate-spin" aria-hidden="true" />
							{:else}
								<RefreshCwIcon class="size-4" aria-hidden="true" />
							{/if}
							{m.video_editor_gate_reconnect_cta()}
						</Button>
						<Button variant="ghost" size="sm" onclick={() => gate.chooseDifferentFolder()}>
							{m.video_editor_gate_different_folder()}
						</Button>
					{/if}
				</div>
			</div>
		{:else if gate.state === 'ready'}
			<div class="w-full max-w-5xl">
				<div class="flex items-center justify-between">
					<h1 class="text-base font-semibold">{m.video_editor_projects_title()}</h1>
					<Button size="sm" onclick={() => (showNewProject = !showNewProject)}>
						<PlusIcon class="size-4" aria-hidden="true" />
						{m.video_editor_project_new()}
					</Button>
				</div>

				{#if showNewProject}
					<form
						class="mt-4 flex gap-2"
						onsubmit={(event) => {
							event.preventDefault();
							void handleCreateProject();
						}}
					>
						<Input
							type="text"
							bind:value={newProjectName}
							placeholder={m.editors_project_name()}
							aria-label={m.editors_project_name()}
							class="bg-[oklch(0.16_0.008_55)]"
						/>
						<Button type="submit" disabled={creating}>
							{#if creating}
								<LoaderIcon class="size-4 animate-spin" aria-hidden="true" />
							{/if}
							{m.video_editor_project_create()}
						</Button>
					</form>
				{/if}

				{#if projectsError}
					<InlineNotice tone="error" class="mt-4">{projectsError}</InlineNotice>
				{/if}

				{#if loadingProjects}
					<PageLoading label={m.editors_loading()} />
				{:else if projects.length === 0}
					<p class="mt-10 text-center text-sm text-[oklch(0.65_0.015_55)]">
						{m.video_editor_projects_empty()}
					</p>
				{:else}
					<ul class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">
						{#each projects as project (project.id)}
							<li>
								<div
									class="group relative rounded-xl border border-[oklch(0.25_0.015_55)] bg-[oklch(0.2_0.01_50)] p-4 transition-colors hover:border-[oklch(0.35_0.02_55)]"
								>
									<button
										type="button"
										class="block w-full rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
										onclick={() => openProject(project)}
									>
										<span class="block truncate font-medium">{project.name}</span>
										<span class="mt-1 block text-xs text-[oklch(0.65_0.015_55)]">
											{new Date(project.updatedAt).toLocaleDateString()}
										</span>
									</button>
									<div
										class="absolute top-3 right-3 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
									>
										<Button
											variant="ghost"
											size="icon-xs"
											aria-label={m.video_editor_project_rename()}
											onclick={() => handleRename(project)}
										>
											<PencilIcon class="size-4" aria-hidden="true" />
										</Button>
										<Button
											variant="ghost"
											size="icon-xs"
											aria-label={m.video_editor_project_delete()}
											onclick={() => confirmDelete(project)}
										>
											<TrashIcon class="size-4" aria-hidden="true" />
										</Button>
									</div>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</main>
</div>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={m.video_editor_project_delete()}
	description={m.video_editor_project_delete_body({ name: pendingDelete?.name ?? '' })}
	confirmLabel={m.video_editor_project_delete()}
	onConfirm={async () => {
		await handleDelete();
		return { ok: true };
	}}
/>
