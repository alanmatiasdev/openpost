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
	import {
		rippleDeleteItems,
		splitAtFrame,
		toggleMarkerAtPlayhead,
		setItemSpeed
	} from '$lib/video-editor/timeline/actions/items';
	import { importFromPicker } from '$lib/video-editor/media/import.svelte';
	import { removeSilenceSignal } from '$lib/video-editor/media/silence';
	import {
		addTransition,
		transitionsStore
	} from '$lib/video-editor/timeline/actions/transitions.svelte';
	import { addSubtitleItemFromSrt } from '$lib/video-editor/transcript/captions';
	import {
		transcribeClip,
		addGeneratedSubtitleItem
	} from '$lib/video-editor/transcript/transcribe-action';
	import { resolveMediaBlob } from '$lib/video-editor/media/import.svelte';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { exportProject } from '$lib/video-editor/media/export';
	import { renderMultiTrackVideo } from '$lib/video-editor/media/render-export';
	import { sendToOpenPost } from '$lib/video-editor/send-to-openpost';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import MediaPoolList from '$lib/video-editor/components/media-pool-list.svelte';
	import EffectsPanel from '$lib/video-editor/components/effects-panel.svelte';
	import TranscriptPanel from '$lib/video-editor/components/transcript-panel.svelte';
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

	let exporting = $state(false);
	let sending = $state(false);
	async function handleExport(): Promise<void> {
		if (!editorSession.project) return;
		exporting = true;
		try {
			editorSession.pausePlayback();
			await editorSession.saveNow();
			const result = await exportProject(
				{
					...editorSession.project,
					timeline: {
						...editorSession.project.timeline,
						items: structuredClone(timelineStore.items),
						tracks: timelineStore.tracks
					}
				},
				{ format: 'mp4' }
			);
			showToast(m.video_editor_export_done({ name: result.fileName }), 'success');
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		} finally {
			exporting = false;
		}
	}

	let rendering = $state(false);
	let renderFrames = $state<{ done: number; total: number } | null>(null);

	async function handleRenderExport(): Promise<void> {
		if (!editorSession.project) return;
		rendering = true;
		renderFrames = null;
		try {
			editorSession.pausePlayback();
			await editorSession.saveNow();
			const result = await renderMultiTrackVideo(
				{
					...editorSession.project,
					timeline: {
						...editorSession.project.timeline,
						items: structuredClone(timelineStore.items),
						tracks: timelineStore.tracks,
						transitions: [...transitionsStore.list]
					}
				},
				{
					format: 'webm',
					onProgress: (progress) => {
						renderFrames = { done: progress.framesDone, total: progress.totalFrames };
					}
				}
			);
			showToast(m.video_editor_export_done({ name: result.fileName }), 'success');
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		} finally {
			rendering = false;
			renderFrames = null;
		}
	}

	async function handleSendToOpenPost(): Promise<void> {
		const workspaceId = workspaceCtx.currentWorkspace?.id;
		if (!workspaceId || !editorSession.project) return;
		sending = true;
		try {
			editorSession.pausePlayback();
			await editorSession.saveNow();
			const result = await exportProject(
				{
					...editorSession.project,
					timeline: {
						...editorSession.project.timeline,
						items: structuredClone(timelineStore.items),
						tracks: timelineStore.tracks
					}
				},
				{ format: 'mp4' }
			);
			await sendToOpenPost({ workspaceId, blob: result.blob, fileName: result.fileName });
			showToast(m.video_editor_sent(), 'success');
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		} finally {
			sending = false;
		}
	}

	let transcribing = $state(false);

	async function handleTranscribe(): Promise<void> {
		if (!selectedItemId || transcribing) return;
		const item = timelineStore.itemById.get(selectedItemId);
		const media = item?.mediaId ? mediaPool.get(item.mediaId) : undefined;
		if (!item || !media) return;
		transcribing = true;
		try {
			const blob = await resolveMediaBlob(media);
			const file =
				blob instanceof File ? blob : new File([blob], media.fileName, { type: media.mimeType });
			const words = await transcribeClip(item, file);
			addGeneratedSubtitleItem(item.id, words);
			editorSession.scheduleAutosave();
			showToast(m.video_editor_transcribe_done(), 'success');
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		} finally {
			transcribing = false;
		}
	}

	async function handleImportCaptions(): Promise<void> {
		const handles = await window.showOpenFilePicker?.({
			types: [{ description: 'Subtitles', accept: { 'text/plain': ['.srt', '.vtt'] } }],
			multiple: false
		});
		if (!handles?.[0]) return;
		try {
			const file = await handles[0].getFile();
			addSubtitleItemFromSrt(await file.text());
			editorSession.scheduleAutosave();
		} catch (err) {
			if (err instanceof Error && err.name !== 'AbortError') {
				showToast(err.message, 'error');
			}
		}
	}

	function applySpeed(multiplier: number): void {
		if (!selectedItemId) return;
		const item = timelineStore.itemById.get(selectedItemId);
		if (!item || item.type === 'text' || item.type === 'subtitle') return;
		setItemSpeed(item.id, Math.round((item.speed ?? 1) * multiplier * 100) / 100);
		editorSession.scheduleAutosave();
	}

	const selectedIsMedia = $derived(
		selectedItemId !== null &&
			['video', 'audio'].includes(timelineStore.itemById.get(selectedItemId)?.type ?? '')
	);

	let showTranscript = $state(false);

	function handleAddCrossfade(): void {
		if (!selectedItemId) return;
		const item = timelineStore.itemById.get(selectedItemId);
		if (!item) return;
		const neighbors = (timelineStore.itemsByTrackId.get(item.trackId) ?? [])
			.filter((other) => other.from >= item.from + item.durationInFrames - 1)
			.sort((a, b) => a.from - b.from);
		const next = neighbors[0];
		if (!next) {
			showToast(m.video_editor_no_neighbor(), 'error');
			return;
		}
		try {
			addTransition(item.id, next.id, 'crossfade');
			editorSession.scheduleAutosave();
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		}
	}

	let removingSilence = $state(false);
	async function handleRemoveSilence(): Promise<void> {
		const ids = selectedItemId ? [selectedItemId] : timelineStore.items.map((i) => i.id);
		if (ids.length === 0) return;
		removingSilence = true;
		try {
			editorSession.pausePlayback();
			await removeSilenceSignal(ids, { mode: 'signal', minSilenceMs: 500 });
			editorSession.scheduleAutosave();
			showToast(m.video_editor_silence_done(), 'success');
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		} finally {
			removingSilence = false;
		}
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
		// SAFETY: event targets in this page are HTML elements.
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
		} else if (event.key === 'm' || event.key === 'M') {
			toggleMarkerAtPlayhead();
			editorSession.scheduleAutosave();
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
					<Button size="sm" variant="outline" disabled={!selectedItemId} onclick={handleDelete}>
						{m.video_editor_delete_clip()}
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={!selectedItemId}
						onclick={handleAddCrossfade}
					>
						{m.video_editor_crossfade()}
					</Button>
					{#if selectedIsMedia}
						<EffectsPanel itemId={selectedItemId} onedit={() => editorSession.scheduleAutosave()} />
					{/if}
					<div class="mt-2 border-t border-[oklch(0.25_0.015_55)] pt-2">
						<Button
							size="sm"
							variant="outline"
							class="w-full"
							aria-expanded={showTranscript}
							onclick={() => (showTranscript = !showTranscript)}
						>
							{showTranscript ? m.video_editor_transcript_hide() : m.video_editor_transcript_show()}
						</Button>
						{#if showTranscript}
							<div
								class="mt-1 max-h-64 overflow-y-auto rounded-md border border-[oklch(0.25_0.015_55)] p-1"
							>
								<TranscriptPanel onedit={() => editorSession.scheduleAutosave()} />
							</div>
						{/if}
					</div>
					<div class="mt-2 border-t border-[oklch(0.25_0.015_55)] pt-2">
						<Button
							size="sm"
							variant="outline"
							disabled={removingSilence || timelineStore.items.length === 0}
							onclick={handleRemoveSilence}
						>
							{#if removingSilence}
								<LoaderIcon class="size-3.5 animate-spin" aria-hidden="true" />
							{/if}
							{m.video_editor_remove_silence()}
						</Button>
					</div>
					<div class="mt-2 border-t border-[oklch(0.25_0.015_55)] pt-2">
						<Button
							size="sm"
							disabled={exporting || timelineStore.items.length === 0}
							onclick={handleExport}
						>
							{m.video_editor_export()}
						</Button>
						<Button
							size="sm"
							variant="secondary"
							class="mt-1 w-full"
							disabled={rendering || timelineStore.items.length === 0}
							onclick={handleRenderExport}
						>
							{#if rendering}
								<LoaderIcon class="size-3.5 animate-spin" aria-hidden="true" />
							{/if}
							{m.video_editor_export_render()}
						</Button>
						{#if renderFrames}
							<div
								class="mt-1 rounded-md border border-[oklch(0.25_0.015_55)] p-1 text-[10px] text-[oklch(0.65_0.015_55)]"
								role="status"
							>
								<p class="text-center">
									{m.video_editor_render_progress({
										done: renderFrames.done,
										total: renderFrames.total
									})}
								</p>
								<div
									class="mt-1 h-1 overflow-hidden rounded-full bg-[oklch(0.25_0.015_55)]"
									aria-hidden="true"
								>
									<div
										class="h-full bg-[oklch(0.66_0.14_45)] transition-[width]"
										style="width: {Math.round(
											(renderFrames.done / Math.max(renderFrames.total, 1)) * 100
										)}%;"
									></div>
								</div>
							</div>
						{/if}
						<Button
							size="sm"
							variant="secondary"
							class="mt-1 w-full"
							disabled={sending ||
								timelineStore.items.length === 0 ||
								!workspaceCtx.currentWorkspace}
							onclick={handleSendToOpenPost}
						>
							{m.video_editor_send_to_openpost()}
						</Button>
					</div>
				</aside>
			</div>

			<footer class="border-t border-[oklch(0.25_0.015_55)]">
				<TimelinePanel bind:selectedItemId onedit={() => editorSession.scheduleAutosave()} />
			</footer>
		{/key}
	{/if}
</div>
