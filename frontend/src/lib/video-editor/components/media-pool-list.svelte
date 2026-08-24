<!-- Media pool list: imported sources with probe status; click adds to timeline -->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { getMediaObjectUrl } from '$lib/video-editor/media/media-source';
	import { addItems } from '$lib/video-editor/timeline/actions/items';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
	import { nestSequence, switchSequence } from '$lib/video-editor/sequences/sequence-actions';
	import { showToast } from '$lib/toast';
	import FilmIcon from '@lucide/svelte/icons/film';
	import ImageIcon from '@lucide/svelte/icons/image-plus';
	import LinkIcon from '@lucide/svelte/icons/link';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import Music2Icon from '@lucide/svelte/icons/music-2';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import LayersIcon from '@lucide/svelte/icons/layers-3';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CaptionsIcon from '@lucide/svelte/icons/captions';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import EmbeddedSubtitlePicker from './embedded-subtitle-picker.svelte';
	import {
		canExtractEmbeddedSubtitles,
		type EmbeddedSubtitleInsertResult
	} from '$lib/video-editor/media/embedded-subtitle-service';
	import type { MediaMetadata } from '$lib/video-editor/media/types';
	import { readBlob } from '$lib/video-editor/workspace-fs/fs-primitives';
	import { requireWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
	import { mediaThumbnailPath } from '$lib/video-editor/workspace-fs/paths';
	import {
		filterAndSortMedia,
		formatMediaListSummary,
		groupMediaByKind,
		type MediaLibraryFilter,
		type MediaLibraryKind,
		type MediaLibrarySort
	} from '$lib/video-editor/media/library-view';
	import { importMediaFromUrl } from '$lib/video-editor/media/import-url';
	import MediaInfoPopover from './media-info-popover.svelte';
	import MediaUrlImportDialog from './media-url-import-dialog.svelte';

	let {
		projectId,
		onsequenceopen = () => undefined,
		onsourceopen = () => undefined
	}: {
		projectId: string;
		onsequenceopen?: () => void;
		onsourceopen?: (mediaId: string) => void;
	} = $props();

	let objectUrls = $state<Record<string, string>>({});
	let subtitlePickerOpen = $state(false);
	let subtitleMedia = $state<MediaMetadata | null>(null);
	let urlImportOpen = $state(false);
	let query = $state('');
	let filter = $state<MediaLibraryFilter>('all');
	let sort = $state<MediaLibrarySort>('added');
	const ownedThumbnailUrls = new Map<string, string>();
	let loadedThumbnailRevision = -1;
	const visibleMedia = $derived(filterAndSortMedia(mediaPool.mediaList, query, filter, sort));
	const mediaGroups = $derived(groupMediaByKind(visibleMedia));
	const canvasWidth = $derived(
		sequenceStore.activeSequence?.width ?? editorSession.project?.metadata.width ?? 1920
	);
	const canvasHeight = $derived(
		sequenceStore.activeSequence?.height ?? editorSession.project?.metadata.height ?? 1080
	);

	async function previewUrl(id: string): Promise<void> {
		const media = mediaPool.get(id);
		if (!media || objectUrls[id]) return;
		try {
			const thumbnail = await readBlob(requireWorkspaceRoot(), mediaThumbnailPath(id));
			if (thumbnail) {
				const thumbnailUrl = URL.createObjectURL(thumbnail);
				const previous = ownedThumbnailUrls.get(id);
				if (previous) URL.revokeObjectURL(previous);
				ownedThumbnailUrls.set(id, thumbnailUrl);
				objectUrls[id] = thumbnailUrl;
			} else if (media.tags.includes('image')) {
				objectUrls[id] = await getMediaObjectUrl(media);
			}
		} catch {
			// Preview unavailable; tile stays generic.
		}
	}

	function syncThumbnails(revision: number, ids: readonly string[]): void {
		if (revision !== loadedThumbnailRevision) {
			loadedThumbnailRevision = revision;
			for (const url of ownedThumbnailUrls.values()) URL.revokeObjectURL(url);
			ownedThumbnailUrls.clear();
			objectUrls = {};
		}
		const activeIds = new Set(ids);
		for (const [id, url] of ownedThumbnailUrls) {
			if (activeIds.has(id)) continue;
			URL.revokeObjectURL(url);
			ownedThumbnailUrls.delete(id);
			delete objectUrls[id];
		}
		for (const id of ids) void previewUrl(id);
	}

	$effect(() => {
		syncThumbnails(mediaPool.thumbnailRevision, mediaPool.order);
	});

	onDestroy(() => {
		for (const url of ownedThumbnailUrls.values()) URL.revokeObjectURL(url);
		ownedThumbnailUrls.clear();
	});

	function groupLabel(kind: MediaLibraryKind): string {
		switch (kind) {
			case 'video':
				return m.video_editor_media_filter_video();
			case 'audio':
				return m.video_editor_media_filter_audio();
			case 'image':
				return m.video_editor_media_filter_image();
			case 'lottie':
				return m.video_editor_media_filter_lottie();
			default:
				return m.video_editor_media_filter_other();
		}
	}

	function changeFilter(value: string | undefined): void {
		if (
			value === 'all' ||
			value === 'video' ||
			value === 'audio' ||
			value === 'image' ||
			value === 'lottie'
		) {
			filter = value;
		}
	}

	function changeSort(value: string | undefined): void {
		if (value === 'added' || value === 'name' || value === 'duration' || value === 'size') {
			sort = value;
		}
	}

	async function importUrl(url: string): Promise<void> {
		const id = await importMediaFromUrl(url, { projectId, storageMode: 'copy' });
		const imported = mediaPool.get(id);
		showToast(m.video_editor_media_import_url_done({ name: imported?.fileName ?? id }), 'success');
	}

	function addToTimeline(mediaId: string): void {
		const media = mediaPool.get(mediaId);
		if (!media) return;
		const fps = editorSession.fps;
		const isAudio = media.tags.includes('audio');
		const isLottie = media.tags.includes('lottie');
		const isImage = media.tags.includes('image');
		const itemType = isAudio ? 'audio' : isLottie ? 'lottie' : isImage ? 'image' : 'video';
		const durationFrames = Math.max(1, Math.round((media.duration || (isImage ? 3 : 1)) * fps));
		const targetTrack = timelineStore.tracks
			.filter(
				(track) => (isAudio ? track.kind === 'audio' : track.kind !== 'audio') && !track.locked
			)
			.toSorted((left, right) => right.order - left.order)[0];
		if (!targetTrack) return;
		const trackId = targetTrack.id;
		const canvasWidth =
			sequenceStore.activeSequence?.width ?? editorSession.project?.metadata.width ?? 1920;
		const canvasHeight =
			sequenceStore.activeSequence?.height ?? editorSession.project?.metadata.height ?? 1080;
		const sourceWidth = media.width || canvasWidth;
		const sourceHeight = media.height || canvasHeight;
		const fitScale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
		// Place after the last item on the target track.
		const trackItems = timelineStore.itemsByTrackId.get(trackId) ?? [];
		const end = trackItems.reduce(
			(max, item) => Math.max(max, item.from + item.durationInFrames),
			0
		);
		addItems([
			{
				id: crypto.randomUUID(),
				trackId,
				from: end,
				durationInFrames: durationFrames,
				label: media.fileName,
				type: itemType,
				mediaId,
				sourceStart: 0,
				sourceEnd: isImage
					? undefined
					: Math.max(1, Math.round(media.duration * (media.fps || fps))),
				sourceDuration: isImage
					? durationFrames
					: Math.max(1, Math.round(media.duration * (media.fps || fps))),
				sourceFps: media.fps > 0 ? media.fps : undefined,
				sourceWidth: isAudio ? undefined : sourceWidth,
				sourceHeight: isAudio ? undefined : sourceHeight,
				transform: isAudio
					? undefined
					: {
							x: 0,
							y: 0,
							width: Math.round(sourceWidth * fitScale),
							height: Math.round(sourceHeight * fitScale),
							rotation: 0
						},
				lottieTotalFrames: isLottie ? (media.lottieTotalFrames ?? 1) : undefined,
				lottieFrameRate: isLottie ? media.fps || 30 : undefined,
				lottieLoop: isLottie ? true : undefined,
				lottieMarkers: isLottie ? media.lottieMarkers : undefined
			}
		]);
		editorSession.scheduleAutosave();
	}

	function openSequence(id: string): void {
		sequenceStore.promoteToTab(id);
		editorSession.pausePlayback();
		if (!switchSequence(id)) return;
		editorSession.syncTimelineClock();
		onsequenceopen();
		editorSession.scheduleAutosave();
	}

	function addSequence(id: string): void {
		try {
			nestSequence(id);
			editorSession.scheduleAutosave();
		} catch (error) {
			showToast(error instanceof Error ? error.message : m.video_editor_sequence_cycle(), 'error');
		}
	}

	function openSubtitlePicker(media: MediaMetadata): void {
		subtitleMedia = media;
		subtitlePickerOpen = true;
	}

	function handleSubtitleInsert(result: EmbeddedSubtitleInsertResult): void {
		if (result.itemIds.length === 0) {
			showToast(m.video_editor_subtitle_outside_clips(), 'error');
			return;
		}
		editorSession.scheduleAutosave();
		showToast(m.video_editor_subtitle_inserted({ count: result.cueCount }), 'success');
	}
</script>

<div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
	<div
		class="sticky top-0 z-10 -mx-2 space-y-1.5 border-b border-[oklch(0.25_0.012_55)] bg-[oklch(0.135_0.008_50)] px-2 pb-2"
	>
		<div class="flex items-center gap-1.5">
			<label class="relative min-w-0 flex-1">
				<span class="sr-only">{m.video_editor_media_search()}</span>
				<SearchIcon
					class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[oklch(0.58_0.015_55)]"
					aria-hidden="true"
				/>
				<input
					type="search"
					bind:value={query}
					placeholder={m.video_editor_media_search()}
					class="h-8 w-full rounded-md border border-[oklch(0.28_0.014_55)] bg-[oklch(0.18_0.008_50)] pr-2 pl-7 text-xs outline-none placeholder:text-[oklch(0.54_0.012_55)] focus-visible:border-[var(--video-editor-focus)] focus-visible:ring-2 focus-visible:ring-[var(--video-editor-focus)]/25"
				/>
			</label>
			<Button
				type="button"
				variant="outline"
				size="icon-xs"
				aria-label={m.video_editor_media_import_url()}
				title={m.video_editor_media_import_url()}
				onclick={() => (urlImportOpen = true)}
			>
				<LinkIcon class="size-3.5" aria-hidden="true" />
			</Button>
		</div>
		<div class="grid grid-cols-2 gap-1.5">
			<div class="min-w-0">
				<Select.Root type="single" value={filter} onValueChange={changeFilter}>
					<Select.Trigger
						aria-label={m.video_editor_media_filter()}
						class="h-7! w-full! rounded-md! border-[oklch(0.28_0.014_55)]! bg-[oklch(0.18_0.008_50)]! px-1.5! py-0! text-[10px]! text-[var(--video-editor-text)]! shadow-none! hover:translate-y-0! hover:bg-[oklch(0.21_0.01_50)]! aria-expanded:translate-y-0!"
					>
						{filter === 'all'
							? m.video_editor_media_filter_all()
							: filter === 'video'
								? m.video_editor_media_filter_video()
								: filter === 'audio'
									? m.video_editor_media_filter_audio()
									: filter === 'image'
										? m.video_editor_media_filter_image()
										: m.video_editor_media_filter_lottie()}
					</Select.Trigger>
					<Select.Content
						class="video-editor-theme rounded-md! border-[oklch(0.31_0.018_55)]! bg-[oklch(0.16_0.012_50)]! text-[var(--video-editor-text)]! shadow-lg!"
					>
						<Select.Item value="all">{m.video_editor_media_filter_all()}</Select.Item>
						<Select.Item value="video">{m.video_editor_media_filter_video()}</Select.Item>
						<Select.Item value="audio">{m.video_editor_media_filter_audio()}</Select.Item>
						<Select.Item value="image">{m.video_editor_media_filter_image()}</Select.Item>
						<Select.Item value="lottie">{m.video_editor_media_filter_lottie()}</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>
			<div class="min-w-0">
				<Select.Root type="single" value={sort} onValueChange={changeSort}>
					<Select.Trigger
						aria-label={m.video_editor_media_sort()}
						class="h-7! w-full! rounded-md! border-[oklch(0.28_0.014_55)]! bg-[oklch(0.18_0.008_50)]! px-1.5! py-0! text-[10px]! text-[var(--video-editor-text)]! shadow-none! hover:translate-y-0! hover:bg-[oklch(0.21_0.01_50)]! aria-expanded:translate-y-0!"
					>
						{sort === 'added'
							? m.video_editor_media_sort_added()
							: sort === 'name'
								? m.video_editor_media_sort_name()
								: sort === 'duration'
									? m.video_editor_media_sort_duration()
									: m.video_editor_media_sort_size()}
					</Select.Trigger>
					<Select.Content
						class="video-editor-theme rounded-md! border-[oklch(0.31_0.018_55)]! bg-[oklch(0.16_0.012_50)]! text-[var(--video-editor-text)]! shadow-lg!"
					>
						<Select.Item value="added">{m.video_editor_media_sort_added()}</Select.Item>
						<Select.Item value="name">{m.video_editor_media_sort_name()}</Select.Item>
						<Select.Item value="duration">{m.video_editor_media_sort_duration()}</Select.Item>
						<Select.Item value="size">{m.video_editor_media_sort_size()}</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>
		</div>
	</div>

	{#if sequenceStore.compositions.length > 0}
		<section class="mb-2" aria-labelledby="video-editor-sequences-heading">
			<h3
				id="video-editor-sequences-heading"
				class="px-1 py-1.5 text-[10px] font-medium tracking-wider text-[oklch(0.62_0.015_55)] uppercase"
			>
				{m.video_editor_sequences()}
			</h3>
			<ul class="flex flex-col gap-1">
				{#each sequenceStore.compositions as sequence (sequence.id)}
					<li
						class="group flex items-center gap-2 rounded-md bg-[oklch(0.19_0.01_50)] p-1.5 hover:bg-[oklch(0.22_0.01_50)]"
					>
						<span
							class="flex size-10 shrink-0 items-center justify-center rounded bg-[oklch(0.26_0.025_250)]"
						>
							<LayersIcon class="size-4" aria-hidden="true" />
						</span>
						<button
							type="button"
							class="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
							title={m.video_editor_sequence_open()}
							onclick={() => openSequence(sequence.id)}
						>
							<span class="block truncate text-xs font-medium">{sequence.name}</span>
							<span class="block text-[10px] text-[oklch(0.62_0.015_55)]">
								{sequence.durationInFrames}f · {sequence.width}×{sequence.height}
							</span>
						</button>
						<button
							type="button"
							class="rounded p-1.5 text-[oklch(0.68_0.015_55)] opacity-70 hover:bg-white/10 hover:text-white hover:opacity-100 focus:opacity-100 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
							aria-label={`${m.video_editor_sequence_add()}: ${sequence.name}`}
							onclick={() => addSequence(sequence.id)}
						>
							<PlusIcon class="size-3.5" aria-hidden="true" />
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
	{#each mediaGroups as group (group.kind)}
		<section aria-labelledby={`video-editor-media-${group.kind}`}>
			<h3
				id={`video-editor-media-${group.kind}`}
				class="flex items-center justify-between px-1 py-1.5 text-[10px] font-medium tracking-wider text-[oklch(0.62_0.015_55)] uppercase"
			>
				<span>{groupLabel(group.kind)}</span>
				<span class="tabular-nums">{group.media.length}</span>
			</h3>
			<ul class="flex flex-col gap-1" role="list">
				{#each group.media as media (media.id)}
					{@const id = media.id}
					{@const entry = mediaPool.entry(id)}
					<li class="group flex items-center gap-1 rounded-md p-1 hover:bg-[oklch(0.22_0.01_50)]">
						<button
							type="button"
							class="flex min-w-0 flex-1 items-center gap-2 rounded p-0.5 text-left focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:opacity-60"
							disabled={entry?.status !== 'ready'}
							onclick={() => entry && onsourceopen(id)}
							title={m.video_editor_source_monitor()}
						>
							<span
								class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-[oklch(0.22_0.01_50)]"
							>
								{#if entry?.status === 'importing'}
									<LoaderIcon class="size-4 animate-spin" aria-hidden="true" />
								{:else if objectUrls[id] && !entry?.media.tags.includes('audio')}
									<img src={objectUrls[id]} alt="" class="size-full object-cover" />
								{:else if entry?.media.tags.includes('lottie')}
									<SparklesIcon class="size-4" aria-hidden="true" />
								{:else if entry?.media.tags.includes('audio')}
									<Music2Icon class="size-4" aria-hidden="true" />
								{:else if entry?.status === 'failed'}
									<span class="text-xs text-red-400">!</span>
								{:else}
									<FilmIcon class="size-4" aria-hidden="true" />
								{/if}
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-xs font-medium">{entry?.media.fileName}</span>
								{#if entry?.status === 'ready'}
									<span class="block text-[11px] text-[oklch(0.65_0.015_55)]">
										{formatMediaListSummary(entry.media)}
									</span>
								{/if}
							</span>
						</button>
						{#if entry}
							<MediaInfoPopover media={entry.media} />
						{/if}
						{#if entry?.status === 'ready' && canExtractEmbeddedSubtitles(entry.media)}
							<Button
								variant="ghost"
								size="icon-xs"
								class="text-[oklch(0.68_0.015_55)] opacity-70 hover:bg-white/10 hover:text-white hover:opacity-100 focus:opacity-100"
								aria-label={`${m.video_editor_extract_embedded_subtitles()}: ${entry.media.fileName}`}
								title={m.video_editor_extract_embedded_subtitles()}
								onclick={() => openSubtitlePicker(entry.media)}
							>
								<CaptionsIcon class="size-3.5" aria-hidden="true" />
							</Button>
						{/if}
						<button
							type="button"
							class="rounded p-1.5 text-[oklch(0.68_0.015_55)] opacity-70 hover:bg-white/10 hover:text-white hover:opacity-100 focus:opacity-100 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:opacity-30"
							disabled={entry?.status !== 'ready'}
							aria-label={`${m.video_editor_media_add()}: ${entry?.media.fileName ?? ''}`}
							onclick={() => entry && addToTimeline(id)}
						>
							<PlusIcon class="size-3.5" aria-hidden="true" />
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
	{#if mediaPool.order.length === 0}
		<div class="px-2 py-6 text-center text-xs text-[oklch(0.65_0.015_55)]">
			<ImageIcon class="mx-auto mb-2 size-5" aria-hidden="true" />
			{m.video_editor_media_empty()}
		</div>
	{:else if visibleMedia.length === 0}
		<p class="px-2 py-6 text-center text-xs text-[oklch(0.65_0.015_55)]">
			{m.video_editor_media_no_results()}
		</p>
	{/if}
</div>

<EmbeddedSubtitlePicker
	media={subtitleMedia}
	bind:open={subtitlePickerOpen}
	{canvasWidth}
	{canvasHeight}
	oninsert={handleSubtitleInsert}
/>

<MediaUrlImportDialog bind:open={urlImportOpen} onimport={importUrl} />
