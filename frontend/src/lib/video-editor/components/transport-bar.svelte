<!-- Transport: play/pause, frame stepping, in/out, timecode -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		setCurrentFrame,
		setInPoint,
		setOutPoint
	} from '$lib/video-editor/timeline/actions/items';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SkipBackIcon from '@lucide/svelte/icons/skip-back';
	import SquareIcon from '@lucide/svelte/icons/square';

	const playing = $derived(editorSession.clock.isPlaying);
	const fps = $derived(editorSession.fps);

	const timecode = $derived.by(() => {
		const total = timelineStore.currentFrame / fps;
		const minutes = Math.floor(total / 60);
		const seconds = Math.floor(total % 60);
		const frames = Math.round((total % 1) * fps);
		return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
	});
</script>

<div
	class="flex items-center justify-center gap-1 border-t border-[oklch(0.25_0.015_55)] px-3 py-1.5"
>
	<Button
		size="icon-xs"
		variant="ghost"
		aria-label={m.video_editor_go_to_start()}
		onclick={() => setCurrentFrame(0)}
	>
		<SkipBackIcon />
	</Button>
	<Button
		size="icon-xs"
		variant="ghost"
		aria-label={m.video_editor_step_back()}
		onclick={() => setCurrentFrame(timelineStore.currentFrame - 1)}
	>
		<span class="text-[10px]">◀◀</span>
	</Button>
	<Button
		size="icon-xs"
		aria-label={playing ? m.video_editor_pause() : m.video_editor_play()}
		onclick={() =>
			playing
				? editorSession.pausePlayback()
				: editorSession.startPlayback({
						start: timelineStore.inPoint ?? 0,
						end: timelineStore.outPoint ?? Math.max(timelineStore.maxItemEndFrame, 1),
						loop: true
					})}
	>
		{#if playing}
			<PauseIcon />
		{:else}
			<PlayIcon />
		{/if}
	</Button>
	<Button
		size="icon-xs"
		variant="ghost"
		aria-label={m.video_editor_stop()}
		onclick={() => editorSession.stopPlayback()}
	>
		<SquareIcon />
	</Button>
	<Button
		size="icon-xs"
		variant="ghost"
		aria-label={m.video_editor_step_forward()}
		onclick={() => setCurrentFrame(timelineStore.currentFrame + 1)}
	>
		<span class="text-[10px]">▶▶</span>
	</Button>

	<span class="ml-3 rounded bg-[oklch(0.18_0.008_55)] px-2 py-0.5 font-mono text-xs tabular-nums">
		{timecode}
	</span>

	<div class="mx-auto flex items-center gap-1">
		<Button size="xs" variant="outline" onclick={() => setInPoint(timelineStore.currentFrame)}>
			{m.video_editor_mark_in()}
		</Button>
		<Button size="xs" variant="outline" onclick={() => setOutPoint(timelineStore.currentFrame)}>
			{m.video_editor_mark_out()}
		</Button>
		{#if timelineStore.inPoint !== null || timelineStore.outPoint !== null}
			<Button
				size="xs"
				variant="ghost"
				onclick={() => {
					setInPoint(null);
					setOutPoint(null);
				}}
			>
				{m.video_editor_clear_marks()}
			</Button>
		{/if}
	</div>
</div>
