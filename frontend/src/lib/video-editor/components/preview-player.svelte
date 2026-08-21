<!-- Preview player: pooled <video> synced to the session clock -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { getMediaObjectUrl, revokeMediaObjectUrl } from '$lib/video-editor/media/media-source';
	import {
		incomingOpacity,
		outgoingOpacity,
		transitionsStore,
		transitionAtFrame
	} from '$lib/video-editor/timeline/actions/transitions.svelte';
	import type { TimelineItem } from '$lib/video-editor/project/types';

	const project = $derived(editorSession.project);
	const aspect = $derived(
		project && project.metadata.height > 0
			? `${project.metadata.width} / ${project.metadata.height}`
			: '16 / 9'
	);

	let videoEl = $state<HTMLVideoElement | null>(null);
	let urls = $state<Record<string, string>>({});

	// The active item at the playhead (first video on the main track).
	const activeItem = $derived.by(() => {
		const frame = timelineStore.currentFrame;
		return (
			timelineStore.items.find(
				(item) =>
					item.type === 'video' && frame >= item.from && frame < item.from + item.durationInFrames
			) ?? null
		);
	});

	// Transition state at the playhead, if two video clips are blending.
	const blend = $derived.by(() => {
		const frame = timelineStore.currentFrame;
		for (const transition of transitionsStore.list) {
			const stateAt = transitionAtFrame(transition, frame, editorSession.fps);
			if (!stateAt) continue;
			const outgoing = timelineStore.itemById.get(stateAt.outgoing);
			const incoming = timelineStore.itemById.get(stateAt.incoming);
			if (!outgoing || !incoming) continue;
			if (outgoing.type !== 'video' || incoming.type !== 'video') continue;
			return { state: stateAt, outgoing, incoming };
		}
		return null;
	});

	const activeUrl = $derived(
		blend ? (urls[blend.incoming.mediaId ?? ''] ?? null) : (urls[activeItem?.mediaId ?? ''] ?? null)
	);
	const outgoingUrl = $derived(blend ? (urls[blend.outgoing.mediaId ?? ''] ?? null) : null);

	async function loadUrls(): Promise<void> {
		for (const media of mediaPool.mediaList) {
			if (media.tags.includes('audio')) continue;
			if (!urls[media.id]) {
				try {
					urls[media.id] = await getMediaObjectUrl(media);
				} catch {
					// Leave absent; preview falls back to the empty state.
				}
			}
		}
	}

	$effect(() => {
		void loadUrls();
		return () => {
			for (const id of Object.keys(urls)) revokeMediaObjectUrl(id);
			urls = {};
		};
	});

	// Sync the outgoing blend layer under the incoming one.
	let outVideoEl = $state<HTMLVideoElement | null>(null);

	$effect(() => {
		if (!blend || !outgoingUrl || !outVideoEl) return;
		outVideoEl.currentTime = sourceTimeFor(blend.outgoing, timelineStore.currentFrame);
		outVideoEl.style.opacity = String(outgoingOpacity(blend.state.type, blend.state.progress));
	});

	function sourceTimeFor(item: TimelineItem, frame: number): number {
		const fps = editorSession.fps;
		const speed = item.speed ?? 1;
		const relativeFrame = frame - item.from;
		const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : fps;
		return (item.sourceStart ?? 0) / sourceFps + (relativeFrame / fps) * speed;
	}

	// Sync <video> to clock: seek when paused; correct drift while playing.
	$effect(() => {
		const item = activeItem;
		const url = activeUrl;
		if (!item || !url || !videoEl) return;

		const fps = editorSession.fps;
		const speed = item.speed ?? 1;
		const relativeFrame = timelineStore.currentFrame - item.from;
		const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : fps;
		const sourceSeconds = (item.sourceStart ?? 0) / sourceFps + (relativeFrame / fps) * speed;

		const apply = () => {
			if (!videoEl) return;
			if (Math.abs(videoEl.currentTime - sourceSeconds) > 0.08 / Math.abs(speed || 1)) {
				videoEl.currentTime = sourceSeconds;
			}
			videoEl.playbackRate = Math.min(16, Math.max(0.0625, speed));
			if (editorSession.clock.isPlaying) {
				if (videoEl.paused) void videoEl.play().catch(() => undefined);
			} else if (!videoEl.paused) {
				videoEl.pause();
			}
		};
		apply();
		if (outVideoEl && blend) {
			outVideoEl.style.opacity = String(outgoingOpacity(blend.state.type, blend.state.progress));
		}

		const offFrame = editorSession.clock.on('framechange', () => requestAnimationFrame(apply));
		const offPause = editorSession.clock.on('pause', () => videoEl?.pause());
		return () => {
			offFrame();
			offPause();
		};
	});
</script>

<div class="flex min-h-0 flex-1 items-center justify-center bg-[oklch(0.12_0.008_55)] p-4">
	<div class="relative max-h-full max-w-full" style="aspect-ratio: {aspect};">
		{#if activeUrl}
			{#key activeUrl}
				<!-- svelte-ignore a11y_media_has_caption -- editor preview canvas; captions render as subtitle items -->
				<video bind:this={videoEl} src={activeUrl} class="max-h-full rounded-md" playsinline
				></video>
			{/key}
		{:else}
			<div
				class="flex w-full items-center justify-center rounded-md border border-dashed border-[oklch(0.3_0.01_55)] text-xs text-[oklch(0.65_0.015_55)]"
				style="aspect-ratio: {aspect}; min-width: 320px;"
			>
				{m.video_editor_preview_empty()}
			</div>
		{/if}
	</div>
</div>
