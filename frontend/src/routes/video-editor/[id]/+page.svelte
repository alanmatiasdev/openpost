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
		addAdjustmentLayer,
		addTextItem,
		removeItems,
		rippleDeleteItems,
		splitAtFrame,
		splitAtScenes,
		removeMarker,
		setCurrentFrame,
		toggleMarkerAtPlayhead,
		setItemSpeed
	} from '$lib/video-editor/timeline/actions/items';
	import { markerAfter, markerBefore } from '$lib/video-editor/timeline/markers';
	import { scanSceneCuts } from '$lib/video-editor/media/scene-scan';
	import { cutFramesForItem } from '$lib/video-editor/media/scene-math';
	import { insertFreezeFrame } from '$lib/video-editor/media/insert-freeze-frame.svelte';
	import { importFromPicker } from '$lib/video-editor/media/import.svelte';
	import { removeSilenceSignal } from '$lib/video-editor/media/silence';
	import {
		addTransition,
		removeTransition,
		transitionsStore
	} from '$lib/video-editor/timeline/actions/transitions.svelte';
	import { addSubtitleItemFromSrt } from '$lib/video-editor/transcript/captions';
	import {
		transcribeClip,
		addGeneratedSubtitleItem
	} from '$lib/video-editor/transcript/transcribe-action';
	import type {
		ResolvedTranscriptionEngine,
		TranscribeProgress,
		TranscriptionSelection
	} from '$lib/video-editor/transcript/engine/types';
	import { resolveMediaBlob } from '$lib/video-editor/media/import.svelte';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { exportProject } from '$lib/video-editor/media/export';
	import { sendToOpenPost } from '$lib/video-editor/send-to-openpost';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import MediaPoolList from '$lib/video-editor/components/media-pool-list.svelte';
	import SceneBrowserPanel from '$lib/video-editor/components/scene-browser-panel.svelte';
	import VectorAssetPanel from '$lib/video-editor/components/shape-panel.svelte';
	import LocalAiPanel from '$lib/video-editor/components/local-ai-panel.svelte';
	import LottieBrowserPanel from '$lib/video-editor/components/lottie-browser-panel.svelte';
	import EffectsPanel from '$lib/video-editor/components/effects-panel.svelte';
	import MotionPresetsPanel from '$lib/video-editor/components/motion-presets-panel.svelte';
	import ClipPropertiesPanel from '$lib/video-editor/components/clip-properties-panel.svelte';
	import TransitionPropertiesPanel from '$lib/video-editor/components/transition-properties-panel.svelte';
	import ExportDialog from '$lib/video-editor/components/export-dialog.svelte';
	import TranscriptPanel from '$lib/video-editor/components/transcript-panel.svelte';
	import TranscriptionControls from '$lib/video-editor/components/transcription-controls.svelte';
	import PreviewPlayer from '$lib/video-editor/components/preview-player.svelte';
	import SourceMonitor from '$lib/video-editor/components/source-monitor.svelte';
	import TransportBar from '$lib/video-editor/components/transport-bar.svelte';
	import TimelinePanel from '$lib/video-editor/components/timeline-panel.svelte';
	import SequenceTabs from '$lib/video-editor/components/sequence-tabs.svelte';
	import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
	import {
		createCompoundClip,
		dissolveCompoundClip,
		switchSequence
	} from '$lib/video-editor/sequences/sequence-actions';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PlusIcon from '@lucide/svelte/icons/plus';

	const projectId = $derived(page.params.id ?? '');
	let selectedItemId = $state<string | null>(null);
	let selectedItemIds = $state<string[]>([]);
	let selectedTransitionId = $state<string | null>(null);
	let sourceMediaId = $state<string | null>(null);
	let freezingItemId = $state<string | null>(null);
	let assetPanel = $state<'media' | 'scenes' | 'shapes' | 'lottie' | 'ai'>('media');

	$effect(() => {
		if (selectedItemId) selectedTransitionId = null;
	});

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

	function handleGeneratedAudioInserted(itemId: string): void {
		selectedItemId = itemId;
		selectedItemIds = [itemId];
		selectedTransitionId = null;
		editorSession.scheduleAutosave();
		showToast(m.video_editor_local_ai_added(), 'success');
	}

	function handleVectorAssetInserted(itemId: string): void {
		selectedItemId = itemId;
		selectedItemIds = [itemId];
		selectedTransitionId = null;
		editorSession.scheduleAutosave();
	}

	function handleSourceInserted(itemIds: string[]): void {
		selectedItemIds = itemIds;
		selectedItemId = itemIds[0] ?? null;
		selectedTransitionId = null;
	}

	function handleSplit(): void {
		splitAtFrame(timelineStore.currentFrame, undefined);
		editorSession.scheduleAutosave();
	}

	async function handleFreezeFrame(itemId = selectedItemId): Promise<void> {
		if (!itemId || !projectId || freezingItemId) return;
		freezingItemId = itemId;
		try {
			const result = await insertFreezeFrame({
				projectId,
				itemId,
				playheadFrame: timelineStore.currentFrame
			});
			if (!result.ok) {
				const message =
					result.reason === 'locked-track'
						? m.video_editor_freeze_frame_locked()
						: result.reason === 'transition-overlap'
							? m.video_editor_freeze_frame_transition()
							: result.reason === 'source-changed'
								? m.video_editor_freeze_frame_changed()
								: m.video_editor_freeze_frame_select();
				showToast(message, 'info');
				return;
			}
			selectedItemId = result.itemId;
			selectedItemIds = [result.itemId];
			selectedTransitionId = null;
			editorSession.scheduleAutosave();
			showToast(m.video_editor_freeze_frame_added(), 'success');
		} catch (error) {
			showToast(
				m.video_editor_freeze_frame_failed({
					message: error instanceof Error ? error.message : String(error)
				}),
				'error'
			);
		} finally {
			freezingItemId = null;
		}
	}

	function handleDelete(ripple: boolean): void {
		if (!selectedItemId) return;
		const ids = selectedItemIds.length > 0 ? selectedItemIds : [selectedItemId];
		const removedIds = ripple
			? rippleDeleteItems(ids, timelineStore.linkedSelectionEnabled)
			: removeItems(ids, timelineStore.linkedSelectionEnabled);
		if (removedIds.length === 0) return;
		selectedItemId = null;
		selectedItemIds = [];
		editorSession.scheduleAutosave();
	}

	function resetTimelineSelection(): void {
		selectedItemId = null;
		selectedItemIds = [];
		selectedTransitionId = null;
	}

	function handleOpenSequence(compositionId: string): void {
		sequenceStore.promoteToTab(compositionId);
		editorSession.pausePlayback();
		if (!switchSequence(compositionId)) return;
		editorSession.syncTimelineClock();
		resetTimelineSelection();
	}

	function handleCreateCompound(): void {
		const ids =
			selectedItemIds.length > 0 ? selectedItemIds : selectedItemId ? [selectedItemId] : [];
		const compositionId = createCompoundClip(ids, m.video_editor_compound_default());
		if (!compositionId) return;
		selectedItemIds = timelineStore.items
			.filter((item) => item.compositionId === compositionId)
			.map((item) => item.id);
		selectedItemId = selectedItemIds[0] ?? null;
		editorSession.scheduleAutosave();
		showToast(m.video_editor_compound_created(), 'success');
	}

	function handleDissolveCompound(): void {
		if (!selectedItemId) return;
		const restoredIds = dissolveCompoundClip(selectedItemId);
		if (restoredIds.length === 0) return;
		selectedItemIds = restoredIds;
		selectedItemId = restoredIds[0] ?? null;
		editorSession.scheduleAutosave();
	}

	function activeRenderProject() {
		if (!editorSession.project) return null;
		const activeSequence = sequenceStore.activeSequence;
		return {
			...editorSession.project,
			name: activeSequence?.name ?? editorSession.project.name,
			metadata: activeSequence
				? {
						width: activeSequence.width,
						height: activeSequence.height,
						fps: activeSequence.fps,
						backgroundColor: activeSequence.backgroundColor ?? '#000000'
					}
				: editorSession.project.metadata,
			timeline: {
				tracks: $state.snapshot(timelineStore.tracks),
				items: $state.snapshot(timelineStore.items),
				transitions: $state.snapshot(transitionsStore.list),
				markers: $state.snapshot(timelineStore.markers),
				inPoint: timelineStore.inPoint ?? undefined,
				outPoint: timelineStore.outPoint ?? undefined,
				compositions: $state.snapshot(sequenceStore.compositions),
				topLevelSequenceIds: [...sequenceStore.topLevelSequenceIds]
			}
		};
	}

	let exporting = $state(false);
	let sending = $state(false);
	async function handleExport(): Promise<void> {
		if (!editorSession.project) return;
		exporting = true;
		try {
			editorSession.pausePlayback();
			await editorSession.saveNow();
			const project = activeRenderProject();
			if (!project) return;
			const result = await exportProject(project, { format: 'mp4' });
			showToast(m.video_editor_export_done({ name: result.fileName }), 'success');
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		} finally {
			exporting = false;
		}
	}

	const renderProject = $derived(activeRenderProject());

	async function handleSendToOpenPost(): Promise<void> {
		const workspaceId = workspaceCtx.currentWorkspace?.id;
		if (!workspaceId || !editorSession.project) return;
		sending = true;
		try {
			editorSession.pausePlayback();
			await editorSession.saveNow();
			const project = activeRenderProject();
			if (!project) return;
			const result = await exportProject(project, { format: 'mp4' });
			await sendToOpenPost({
				workspaceId,
				blob: result.blob,
				fileName: result.fileName
			});
			showToast(m.video_editor_sent(), 'success');
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		} finally {
			sending = false;
		}
	}

	let transcribing = $state(false);
	let transcriptionProgress = $state<TranscribeProgress | null>(null);
	let transcriptionBackend = $state<'webgpu' | 'wasm' | null>(null);
	let transcriptionFallback = $state<ResolvedTranscriptionEngine | null>(null);
	let transcriptionAbort: AbortController | null = null;

	function handleAddText(): void {
		const id = addTextItem(m.video_editor_text_default_label());
		selectedItemId = id;
		editorSession.scheduleAutosave();
	}

	function handleAddAdjustmentLayer(): void {
		const id = addAdjustmentLayer(m.video_editor_adjustment_layer());
		selectedItemId = id;
		editorSession.scheduleAutosave();
	}

	async function handleTranscribe(selection: TranscriptionSelection): Promise<void> {
		if (!selectedItemId || transcribing) return;
		const item = timelineStore.itemById.get(selectedItemId);
		const media = item?.mediaId ? mediaPool.get(item.mediaId) : undefined;
		if (!item || !media) return;
		transcribing = true;
		transcriptionProgress = null;
		transcriptionBackend = null;
		transcriptionFallback = null;
		const abort = new AbortController();
		transcriptionAbort = abort;
		try {
			const blob = await resolveMediaBlob(media);
			const file =
				blob instanceof File ? blob : new File([blob], media.fileName, { type: media.mimeType });
			const words = await transcribeClip(item, file, {
				model: selection.model,
				language: selection.language,
				quantization: selection.quantization,
				signal: abort.signal,
				onProgress: (progress) => (transcriptionProgress = progress),
				onRuntimeInfo: (runtime) => {
					if (runtime.backend) transcriptionBackend = runtime.backend;
				},
				onFallback: (fallback) => (transcriptionFallback = fallback)
			});
			addGeneratedSubtitleItem(item.id, words);
			editorSession.scheduleAutosave();
			showToast(m.video_editor_transcribe_done(), 'success');
		} catch (err) {
			if (!(err instanceof DOMException && err.name === 'AbortError')) {
				showToast(err instanceof Error ? err.message : String(err), 'error');
			}
		} finally {
			transcribing = false;
			transcriptionAbort = null;
		}
	}

	function cancelTranscription(): void {
		transcriptionAbort?.abort();
	}

	async function handleImportCaptions(): Promise<void> {
		const handles = await window.showOpenFilePicker?.({
			types: [
				{
					description: 'Subtitles',
					accept: { 'text/plain': ['.srt', '.vtt'] }
				}
			],
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

	const selectedSupportsEffects = $derived(
		selectedItemId !== null && timelineStore.itemById.get(selectedItemId)?.type !== 'audio'
	);
	const selectedSupportsMotion = $derived(
		selectedItemId !== null &&
			['video', 'image', 'lottie', 'text', 'subtitle', 'shape', 'composition'].includes(
				timelineStore.itemById.get(selectedItemId)?.type ?? ''
			)
	);
	const selectedIsMedia = $derived(
		selectedItemId !== null &&
			['video', 'audio'].includes(timelineStore.itemById.get(selectedItemId)?.type ?? '')
	);

	const selectedIsVideo = $derived(
		selectedItemId !== null && timelineStore.itemById.get(selectedItemId)?.type === 'video'
	);
	const selectedIsCompound = $derived(
		selectedItemId !== null && Boolean(timelineStore.itemById.get(selectedItemId)?.compositionId)
	);
	const selectedTransition = $derived(
		selectedTransitionId
			? transitionsStore.list.find((transition) => transition.id === selectedTransitionId)
			: undefined
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
			selectedTransitionId = addTransition(item.id, next.id, 'crossfade');
			selectedItemId = null;
			selectedItemIds = [];
			editorSession.scheduleAutosave();
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		}
	}

	function handleRemoveTransition(): void {
		if (!selectedTransition) return;
		removeTransition(selectedTransition.id);
		selectedTransitionId = null;
		editorSession.scheduleAutosave();
		showToast(m.video_editor_transition_removed(), 'info');
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

	let scanningScenes = $state(false);
	async function handleAutoSplitScenes(): Promise<void> {
		if (!selectedItemId || scanningScenes) return;
		const item = timelineStore.itemById.get(selectedItemId);
		const media = item?.mediaId ? mediaPool.get(item.mediaId) : undefined;
		if (!item || !media) return;
		scanningScenes = true;
		try {
			editorSession.pausePlayback();
			const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : media.fps;
			const cutFrames = await scanSceneCuts(media, { sourceFps });
			const frames = cutFramesForItem({
				cutSourceFrames: cutFrames,
				sourceFps,
				sourceStart: item.sourceStart,
				speed: item.speed,
				from: item.from,
				timelineFps: timelineStore.fps
			}).filter((frame) => frame > item.from && frame < item.from + item.durationInFrames);
			if (frames.length === 0) {
				showToast(m.video_editor_scene_none(), 'info');
				return;
			}
			splitAtScenes(item.id, frames);
			editorSession.scheduleAutosave();
			showToast(m.video_editor_scene_done({ count: frames.length }), 'success');
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		} finally {
			scanningScenes = false;
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
		const target = event.target as HTMLElement;
		if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
		if (event.code === 'Space') {
			event.preventDefault();
			togglePlay();
		} else if (event.key === 's' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			void editorSession.saveNow();
		} else if (
			(event.key === 'l' || event.key === 'L') &&
			event.shiftKey &&
			!event.altKey &&
			!event.ctrlKey &&
			!event.metaKey
		) {
			event.preventDefault();
			timelineStore._setLinkedSelectionEnabled(!timelineStore.linkedSelectionEnabled);
		} else if ((event.key === 's' || event.key === 'S') && !event.altKey) {
			event.preventDefault();
			timelineStore._setSnapEnabled(!timelineStore.snapEnabled);
		} else if (event.key === 'Delete' || event.key === 'Backspace') {
			const ripple = event.ctrlKey || event.metaKey;
			if (ripple && selectedItemId) {
				event.preventDefault();
				handleDelete(true);
			} else if (!ripple && selectedTransitionId) {
				event.preventDefault();
				removeTransition(selectedTransitionId);
				selectedTransitionId = null;
				editorSession.scheduleAutosave();
			} else if (!ripple && timelineStore.selectedMarkerId) {
				event.preventDefault();
				removeMarker(timelineStore.selectedMarkerId);
				editorSession.scheduleAutosave();
			} else if (!ripple && selectedItemId) {
				event.preventDefault();
				handleDelete(false);
			}
		} else if (event.key === 'b' || event.key === 'B') {
			handleSplit();
		} else if (
			(event.key === 'f' || event.key === 'F') &&
			event.shiftKey &&
			!event.altKey &&
			!event.ctrlKey &&
			!event.metaKey
		) {
			event.preventDefault();
			void handleFreezeFrame();
		} else if ((event.key === 'm' || event.key === 'M') && event.shiftKey) {
			event.preventDefault();
			if (timelineStore.selectedMarkerId) {
				removeMarker(timelineStore.selectedMarkerId);
				editorSession.scheduleAutosave();
			}
		} else if (event.key === 'm' || event.key === 'M') {
			event.preventDefault();
			toggleMarkerAtPlayhead();
			editorSession.scheduleAutosave();
		} else if (event.key === '[' || event.key === ']') {
			const marker =
				event.key === '['
					? markerBefore(timelineStore.markers, timelineStore.currentFrame)
					: markerAfter(timelineStore.markers, timelineStore.currentFrame);
			if (marker) {
				event.preventDefault();
				timelineStore._setSelectedMarkerId(marker.id);
				setCurrentFrame(marker.frame);
			}
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
			<p class="text-sm text-[oklch(0.65_0.015_55)]">
				{editorSession.loadError}
			</p>
			<Button variant="outline" href="/video-editor">{m.video_editor_go_back()}</Button>
		</main>
	{:else}
		{#key projectId}
			<SequenceTabs
				onswitch={resetTimelineSelection}
				onedit={() => editorSession.scheduleAutosave()}
			/>
			<div class="flex min-h-0 flex-1">
				<aside
					class="flex w-72 shrink-0 flex-col border-r border-[oklch(0.25_0.015_55)]"
					aria-label={m.video_editor_media_pool()}
				>
					<div class="flex items-center gap-1 p-2">
						<div class="grid min-w-0 flex-1 grid-cols-5 rounded-md bg-[oklch(0.18_0.01_55)] p-0.5">
							<button
								type="button"
								class:active={assetPanel === 'shapes'}
								class="rounded px-1 py-1 text-[11px] text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
								onclick={() => (assetPanel = 'shapes')}
							>
								{m.video_editor_shapes()}
							</button>
							<button
								type="button"
								class:active={assetPanel === 'media'}
								class="rounded px-2 py-1 text-[11px] text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
								onclick={() => (assetPanel = 'media')}
							>
								{m.video_editor_media_pool()}
							</button>
							<button
								type="button"
								class:active={assetPanel === 'lottie'}
								class="rounded px-0.5 py-1 text-[10px] text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
								onclick={() => (assetPanel = 'lottie')}
							>
								{m.video_editor_lottie()}
							</button>
							<button
								type="button"
								class:active={assetPanel === 'scenes'}
								class="rounded px-2 py-1 text-[11px] text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
								onclick={() => (assetPanel = 'scenes')}
							>
								{m.video_editor_scenes()}
							</button>
							<button
								type="button"
								class:active={assetPanel === 'ai'}
								class="rounded px-2 py-1 text-[11px] text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
								onclick={() => (assetPanel = 'ai')}
							>
								{m.video_editor_local_ai()}
							</button>
						</div>
						{#if assetPanel === 'media'}
							<Button
								size="icon-xs"
								variant="ghost"
								aria-label={m.video_editor_import_media()}
								onclick={handleImport}
							>
								<PlusIcon />
							</Button>
						{/if}
					</div>
					{#if assetPanel === 'media'}
						<MediaPoolList
							onsequenceopen={resetTimelineSelection}
							onsourceopen={(mediaId) => (sourceMediaId = mediaId)}
						/>
					{:else if assetPanel === 'scenes'}
						<SceneBrowserPanel />
					{:else if assetPanel === 'shapes'}
						<VectorAssetPanel oninserted={handleVectorAssetInserted} />
					{:else if assetPanel === 'lottie'}
						<LottieBrowserPanel {projectId} />
					{:else}
						<LocalAiPanel {projectId} oninserted={handleGeneratedAudioInserted} />
					{/if}
				</aside>

				<div
					class:grid={sourceMediaId}
					class:grid-cols-2={sourceMediaId}
					class:flex={!sourceMediaId}
					class="min-w-0 flex-1 bg-[oklch(0.12_0.008_55)]"
				>
					{#if sourceMediaId}
						{#key sourceMediaId}
							<SourceMonitor
								mediaId={sourceMediaId}
								preferredTrackId={selectedItemId
									? timelineStore.itemById.get(selectedItemId)?.trackId
									: undefined}
								onclose={() => (sourceMediaId = null)}
								onedit={() => editorSession.scheduleAutosave()}
								oninserted={handleSourceInserted}
							/>
						{/key}
					{/if}
					<section
						data-video-preview
						class="fullscreen:h-screen fullscreen:w-screen [container-type:inline-size] flex min-w-0 flex-1 flex-col bg-[oklch(0.12_0.008_55)]"
					>
						{#if sourceMediaId}
							<div
								class="flex h-9 shrink-0 items-center border-b border-[oklch(0.23_0.012_55)] px-3 text-[10px] font-semibold tracking-widest text-[oklch(0.67_0.015_55)] uppercase"
							>
								{m.video_editor_program_monitor()}
							</div>
						{/if}
						<PreviewPlayer bind:selectedItemId onedit={() => editorSession.scheduleAutosave()} />
						<TransportBar />
					</section>
				</div>

				<!-- Tools -->
				<aside
					class="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-l border-[oklch(0.25_0.015_55)] p-2"
				>
					<h2 class="px-1 text-xs font-medium tracking-wide text-[oklch(0.65_0.015_55)] uppercase">
						{m.video_editor_tools()}
					</h2>
					<Button size="sm" variant="outline" disabled={!selectedItemId} onclick={handleSplit}>
						{m.video_editor_split()}
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={!selectedItemId}
						title={m.video_editor_delete_leave_gap_hint()}
						onclick={() => handleDelete(false)}
					>
						{m.video_editor_delete_leave_gap()}
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={!selectedItemId}
						title={m.video_editor_ripple_delete_hint()}
						onclick={() => handleDelete(true)}
					>
						{m.video_editor_ripple_delete()}
					</Button>
					{#if selectedIsCompound}
						<Button size="sm" variant="outline" onclick={handleDissolveCompound}>
							{m.video_editor_dissolve_compound()}
						</Button>
					{:else}
						<Button
							size="sm"
							variant="outline"
							disabled={selectedItemIds.length === 0 && !selectedItemId}
							onclick={handleCreateCompound}
						>
							{m.video_editor_create_compound()}
						</Button>
					{/if}
					{#if selectedTransition}
						<Button size="sm" variant="outline" onclick={handleRemoveTransition}>
							{m.video_editor_break_transition()}
						</Button>
					{:else}
						<Button
							size="sm"
							variant="outline"
							disabled={!selectedItemId}
							onclick={handleAddCrossfade}
						>
							{m.video_editor_crossfade()}
						</Button>
					{/if}
					<Button size="sm" variant="outline" onclick={handleAddText}>
						{m.video_editor_add_text()}
					</Button>
					<Button size="sm" variant="outline" onclick={handleAddAdjustmentLayer}>
						{m.video_editor_add_adjustment_layer()}
					</Button>
					{#if selectedTransition}
						<div class="mt-2 border-t border-[oklch(0.25_0.015_55)] pt-2">
							<TransitionPropertiesPanel
								transitionId={selectedTransition.id}
								onedit={() => editorSession.scheduleAutosave()}
								onremove={() => (selectedTransitionId = null)}
							/>
						</div>
					{:else if selectedItemId}
						<div class="mt-2 border-t border-[oklch(0.25_0.015_55)] pt-2">
							<ClipPropertiesPanel
								itemId={selectedItemId}
								onedit={() => editorSession.scheduleAutosave()}
							/>
						</div>
					{/if}
					{#if selectedIsVideo}
						<Button
							size="sm"
							variant="outline"
							disabled={scanningScenes}
							onclick={handleAutoSplitScenes}
						>
							{#if scanningScenes}
								<LoaderIcon class="size-3.5 animate-spin" aria-hidden="true" />
							{/if}
							{m.video_editor_scene_split()}
						</Button>
					{/if}
					{#if selectedSupportsEffects}
						{#if selectedSupportsMotion}
							<MotionPresetsPanel
								itemId={selectedItemId}
								itemIds={selectedItemIds}
								frameWidth={sequenceStore.activeWidth}
								frameHeight={sequenceStore.activeHeight}
								fps={timelineStore.fps}
								onedit={() => editorSession.scheduleAutosave()}
							/>
						{/if}
						<EffectsPanel
							itemId={selectedItemId}
							itemIds={selectedItemIds}
							onedit={() => editorSession.scheduleAutosave()}
						/>
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
							<TranscriptionControls
								canTranscribe={selectedIsMedia}
								busy={transcribing}
								progress={transcriptionProgress}
								backend={transcriptionBackend}
								fallback={transcriptionFallback}
								onstart={(selection) => void handleTranscribe(selection)}
								oncancel={cancelTranscription}
							/>
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
						<div class="mt-1">
							<ExportDialog
								project={renderProject}
								disabled={timelineStore.items.length === 0}
								ondone={(result) =>
									showToast(m.video_editor_export_done({ name: result.fileName }), 'success')}
								onerror={(error) => showToast(error.message, 'error')}
							/>
						</div>
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
				<TimelinePanel
					bind:selectedItemId
					bind:selectedItemIds
					bind:selectedTransitionId
					freezeFramePending={freezingItemId !== null}
					onedit={() => editorSession.scheduleAutosave()}
					onfreezeframe={(itemId) => void handleFreezeFrame(itemId)}
					onopencomposition={handleOpenSequence}
					ontransitionbreak={() => showToast(m.video_editor_transition_removed(), 'info')}
				/>
			</footer>
		{/key}
	{/if}
</div>
