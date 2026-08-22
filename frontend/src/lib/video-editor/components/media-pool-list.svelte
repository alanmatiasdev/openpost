<!-- Media pool list: imported sources with probe status; click adds to timeline -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { getMediaObjectUrl } from '$lib/video-editor/media/media-source';
	import { addItems } from '$lib/video-editor/timeline/actions/items';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import FilmIcon from '@lucide/svelte/icons/film';
	import ImageIcon from '@lucide/svelte/icons/image-plus';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import Music2Icon from '@lucide/svelte/icons/music-2';

	let objectUrls = $state<Record<string, string>>({});

	async function previewUrl(id: string): Promise<void> {
		const media = mediaPool.get(id);
		if (!media || objectUrls[id]) return;
		try {
			objectUrls[id] = await getMediaObjectUrl(media);
		} catch {
			// Preview unavailable; tile stays generic.
		}
	}

	$effect(() => {
		for (const id of mediaPool.order) void previewUrl(id);
	});

	function addToTimeline(mediaId: string): void {
		const media = mediaPool.get(mediaId);
		if (!media) return;
		const fps = editorSession.fps;
		const isAudio = media.tags.includes('audio');
		const durationFrames = Math.max(1, Math.round((media.duration || 3) * fps));
		const trackId = isAudio ? 'track-audio' : 'track-video-main';
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
				type: isAudio ? 'audio' : 'video',
				mediaId,
				sourceStart: 0,
				sourceDuration: durationFrames * (media.fps > 0 ? 1 : 1),
				sourceFps: media.fps > 0 ? media.fps : undefined
			}
		]);
		editorSession.scheduleAutosave();
	}
</script>

<div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
	<ul class="flex flex-col gap-1" role="list">
		{#each mediaPool.order as id (id)}
			{@const entry = mediaPool.entry(id)}
			<li>
				<button
					type="button"
					class="flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-[oklch(0.22_0.01_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:opacity-60"
					disabled={entry?.status !== 'ready'}
					onclick={() => entry && addToTimeline(id)}
					title={m.video_editor_media_add()}
				>
					<span
						class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-[oklch(0.22_0.01_50)]"
					>
						{#if entry?.status === 'importing'}
							<LoaderIcon class="size-4 animate-spin" aria-hidden="true" />
						{:else if objectUrls[id] && !entry?.media.tags.includes('audio')}
							<img src={objectUrls[id]} alt="" class="size-full object-cover" />
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
								{entry.media.duration.toFixed(1)}s
							</span>
						{/if}
					</span>
				</button>
			</li>
		{/each}
		{#if mediaPool.order.length === 0}
			<li class="px-2 py-6 text-center text-xs text-[oklch(0.65_0.015_55)]">
				<ImageIcon class="mx-auto mb-2 size-5" aria-hidden="true" />
				{m.video_editor_media_empty()}
			</li>
		{/if}
	</ul>
</div>
