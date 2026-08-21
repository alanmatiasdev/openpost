<!--
OpenPost Video Editor workspace for one project.
LAYOUT: header / left media pool / center preview + transport / bottom timeline.
OWN-WORLD: dark editing chrome on OpenPost warm neutrals; orange is the only signal color.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import Logo from '$lib/components/Logo.svelte';
	import { showToast } from '$lib/toast';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { rippleDeleteItems, splitAtFrame } from '$lib/video-editor/timeline/actions/items';
	import { importFromPicker } from '$lib/video-editor/media/import.svelte';
	import MediaPoolList from '$lib/video-editor/components/media-pool-list.svelte';
	import PreviewPlayer from '$lib/video-editor/components/preview-player.svelte';
	import TransportBar from '$lib/video-editor/components/transport-bar.svelte';
	import TimelinePanel from '$lib/video-editor/components/timeline-panel.svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PlusIcon from '@lucide/svelte/icons/plus';

	const projectId = $derived(page.params.id ?? '');
	let selectedItemId = $state<string | null>(null);

	$effect(() => {
		if (projectId) void editorSession.load(projectId);
		return () => editorSession.pausePlayback();
	});

	async function handleImport(): Promise<void> {
		if (!projectId) return;
		try {
			await importFromPicker({ projectId, storageMode: 'copy' });
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		}
	}

	function handleSplit(): void {
		splitAtFrame(timelineStore.currentFrame, undefined);
		editorSession.scheduleAutosave();
	}

	function handleDelete(): void {
		if (!selectedItemId) return;
		rippleDeleteItems([selectedItemId]);
		selectedItemId = null;
		editorSession.scheduleAutosave();
	}

	function togglePlay(): void {
		if (editorSession.clock.isPlaying) editorSession.pausePlayback();
		else
			editorSession.startPlayback({
				start: 0,
				end: Math.max(timelineStore.maxItemEndFrame, 1),
				loop: false
			});
	}

	function onKeydown(event: KeyboardEvent): void {
		if ((event.target as HTMLElement)?.tagName === 'INPUT') return;
		if (event.code === 'Space') {
			event.preventDefault();
			togglePlay();
		} else if (event.key === 's' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			void editorSession.saveNow();
		} else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedItemId) {
			event.preventDefault();
			handleDelete();
		} else if (event.key === 'b' || event.key === 'B') {
			handleSplit();
		}
	}
</script>

<svelte:head>
	<title>{editorSession.project?.name ?? m.video_editor_title()}</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<div class="flex h-dvh flex-col bg-[oklch(0.145_0.008_55)] text-[oklch(0.92_0.005_85)]">
	<header
		class="flex items-center justify-between border-b border-[oklch(0.25_0.015_55)] px-3 py-2"
	>
		<a
			href="/video-editor"
			class="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
		>
			<Logo class="h-5 w-auto" />
			<span class="text-sm font-semibold">{m.video_editor_title()}</span>
		</a>
		<span class="truncate px-2 text-sm font-medium">{editorSession.project?.name}</span>
		<div class="flex min-w-24 items-center justify-end gap-2 text-xs text-[oklch(0.65_0.015_55)]">
			{#if editorSession.saving}
				<span>{m.video_editor_saving()}</span>
			{:else if !timelineStore.isDirty}
				<span>{m.video_editor_saved()}</span>
			{/if}
		</div>
	</header>

	{#if editorSession.loading}
		<main class="flex flex-1 items-center justify-center">
			<LoaderIcon class="size-5 animate-spin" aria-hidden="true" />
			<span class="sr-only">{m.editors_loading()}</span>
		</main>
	{:else if editorSession.loadError}
		<main class="flex flex-1 flex-col items-center justify-center gap-3">
			<p class="text-sm text-[oklch(0.65_0.015_55)]">{editorSession.loadError}</p>
			<Button variant="outline" href="/video-editor">{m.video_editor_go_back()}</Button>
		</main>
	{:else}
		{#key projectId}
			<div class="flex min-h-0 flex-1">
				<aside
					class="flex w-56 shrink-0 flex-col border-r border-[oklch(0.25_0.015_55)]"
					aria-label={m.video_editor_media_pool()}
				>
					<div class="flex items-center justify-between px-3 py-2">
						<h2 class="text-xs font-medium tracking-wide text-[oklch(0.65_0.015_55)] uppercase">
							{m.video_editor_media_pool()}
						</h2>
						<Button
							size="icon-xs"
							variant="ghost"
							aria-label={m.video_editor_import_media()}
							onclick={handleImport}
						>
							<PlusIcon />
						</Button>
					</div>
					<MediaPoolList />
				</aside>

				<section class="flex min-w-0 flex-1 flex-col">
					<PreviewPlayer />
					<TransportBar />
				</section>

				<!-- Tools -->
				<aside class="flex w-44 shrink-0 flex-col gap-1 border-l border-[oklch(0.25_0.015_55)] p-2">
					<h2 class="px-1 text-xs font-medium tracking-wide text-[oklch(0.65_0.015_55)] uppercase">
						{m.video_editor_tools()}
					</h2>
					<Button size="sm" variant="outline" disabled={!selectedItemId} onclick={handleSplit}>
						{m.video_editor_split()}
					</Button>
					<Button size="sm" variant="destructive" disabled={!selectedItemId} onclick={handleDelete}>
						{m.video_editor_delete_clip()}
					</Button>
				</aside>
			</div>

			<footer class="border-t border-[oklch(0.25_0.015_55)]">
				<TimelinePanel bind:selectedItemId onedit={() => editorSession.scheduleAutosave()} />
			</footer>
		{/key}
	{/if}
</div>
