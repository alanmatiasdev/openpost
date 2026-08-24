<script lang="ts">
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { m } from '$lib/paraglide/messages';
	import type { Project } from '$lib/video-editor/project/types';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import MoreIcon from '@lucide/svelte/icons/ellipsis';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	let {
		projects,
		loading,
		error,
		creating,
		duplicatingId,
		oncreate,
		onopen,
		onrename,
		onduplicate,
		ondelete
	}: {
		projects: Project[];
		loading: boolean;
		error: string;
		creating: boolean;
		duplicatingId: string | null;
		oncreate: (name: string) => Promise<boolean>;
		onopen: (project: Project) => void;
		onrename: (project: Project) => Promise<void>;
		onduplicate: (project: Project) => Promise<void>;
		ondelete: (project: Project) => Promise<void>;
	} = $props();

	let showNewProject = $state(false);
	let newProjectName = $state('');
	let searchQuery = $state('');
	let projectSort = $state<'updated' | 'created' | 'name'>('updated');
	let pendingDelete = $state<Project | null>(null);
	let deleteDialogOpen = $state(false);

	const visibleProjects = $derived.by(() => {
		const query = searchQuery.trim().toLocaleLowerCase();
		const filtered = query
			? projects.filter((project) =>
					`${project.name} ${project.description ?? ''}`.toLocaleLowerCase().includes(query)
				)
			: projects;
		return [...filtered].sort((a, b) => {
			if (projectSort === 'name') return a.name.localeCompare(b.name);
			return projectSort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt;
		});
	});

	function changeProjectSort(value: string): void {
		if (value === 'updated' || value === 'created' || value === 'name') projectSort = value;
	}

	async function createProject(): Promise<void> {
		const created = await oncreate(newProjectName.trim());
		if (!created) return;
		newProjectName = '';
		showNewProject = false;
	}

	function confirmDelete(project: Project): void {
		pendingDelete = project;
		deleteDialogOpen = true;
	}
</script>

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
				void createProject();
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
				{#if creating}<LoaderIcon class="size-4 animate-spin" aria-hidden="true" />{/if}
				{m.video_editor_project_create()}
			</Button>
		</form>
	{/if}

	<div class="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
		<label class="relative block" for="video-editor-project-search">
			<span class="sr-only">{m.video_editor_project_search()}</span>
			<SearchIcon
				class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[oklch(0.6_0.015_55)]"
				aria-hidden="true"
			/>
			<Input
				id="video-editor-project-search"
				bind:value={searchQuery}
				placeholder={m.video_editor_project_search()}
				class="bg-[oklch(0.16_0.008_55)] pl-9"
			/>
		</label>
		<Select.Root type="single" value={projectSort} onValueChange={changeProjectSort}>
			<Select.Trigger
				aria-label={m.video_editor_project_sort()}
				class="w-full bg-[oklch(0.16_0.008_55)]"
			>
				{projectSort === 'updated'
					? m.video_editor_project_sort_updated()
					: projectSort === 'created'
						? m.video_editor_project_sort_created()
						: m.video_editor_project_sort_name()}
			</Select.Trigger>
			<Select.Content class="video-editor-theme">
				<Select.Item value="updated">{m.video_editor_project_sort_updated()}</Select.Item>
				<Select.Item value="created">{m.video_editor_project_sort_created()}</Select.Item>
				<Select.Item value="name">{m.video_editor_project_sort_name()}</Select.Item>
			</Select.Content>
		</Select.Root>
	</div>

	{#if error}<InlineNotice tone="error" class="mt-4">{error}</InlineNotice>{/if}

	{#if loading}
		<PageLoading label={m.editors_loading()} />
	{:else if projects.length === 0}
		<p class="mt-10 text-center text-sm text-[oklch(0.65_0.015_55)]">
			{m.video_editor_projects_empty()}
		</p>
	{:else if visibleProjects.length === 0}
		<p class="mt-10 text-center text-sm text-[oklch(0.65_0.015_55)]">
			{m.video_editor_projects_no_match()}
		</p>
	{:else}
		<ul class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">
			{#each visibleProjects as project (project.id)}
				<li>
					<div
						class="group relative rounded-xl border border-[oklch(0.25_0.015_55)] bg-[oklch(0.2_0.01_50)] p-4 transition-colors hover:border-[oklch(0.35_0.02_55)]"
					>
						<button
							type="button"
							class="block w-full rounded-md pr-8 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
							onclick={() => onopen(project)}
						>
							<span class="block truncate font-medium">{project.name}</span>
							<span class="mt-1 block text-xs text-[oklch(0.65_0.015_55)]">
								{new Date(project.updatedAt).toLocaleDateString()}
							</span>
						</button>
						<div class="absolute top-3 right-3">
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="ghost"
											size="icon-xs"
											aria-busy={duplicatingId === project.id}
											aria-label={m.video_editor_project_actions({ name: project.name })}
										>
											{#if duplicatingId === project.id}
												<LoaderIcon class="size-4 animate-spin" aria-hidden="true" />
											{:else}
												<MoreIcon class="size-4" aria-hidden="true" />
											{/if}
										</Button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content class="video-editor-theme" align="end">
									<DropdownMenu.Item onclick={() => void onrename(project)}>
										<PencilIcon class="size-4" aria-hidden="true" />
										{m.video_editor_project_rename()}
									</DropdownMenu.Item>
									<DropdownMenu.Item
										disabled={duplicatingId !== null}
										onclick={() => void onduplicate(project)}
									>
										<CopyIcon class="size-4" aria-hidden="true" />
										{m.video_editor_project_duplicate()}
									</DropdownMenu.Item>
									<DropdownMenu.Separator />
									<DropdownMenu.Item
										class="text-red-300 focus:text-red-200"
										onclick={() => confirmDelete(project)}
									>
										<TrashIcon class="size-4" aria-hidden="true" />
										{m.video_editor_project_move_to_trash()}
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={m.video_editor_project_move_to_trash()}
	description={m.video_editor_project_delete_body({ name: pendingDelete?.name ?? '' })}
	confirmLabel={m.video_editor_project_move_to_trash()}
	onConfirm={async () => {
		if (pendingDelete) await ondelete(pendingDelete);
		pendingDelete = null;
		return { ok: true };
	}}
/>
