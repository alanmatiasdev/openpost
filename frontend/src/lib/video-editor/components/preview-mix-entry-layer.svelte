<!-- Leaf audio produced by a nested sequence mix plan. -->
<script lang="ts">
	import { untrack } from 'svelte';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import type { MixEntry } from '$lib/video-editor/media/render-plan';
	import { previewPlaybackSettings } from '$lib/video-editor/preview/playback-settings.svelte';
	import { clampMonitorVolume } from '$lib/video-editor/preview/playback-settings';
	import { SeekScheduler, seekDriftExceeded } from '$lib/video-editor/preview/seek-throttle';
	import { transitionGainAtProgress } from '$lib/video-editor/audio/transition-crossfade';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';

	let { entry, url }: { entry: MixEntry; url?: string | null } = $props();
	let audio = $state<HTMLAudioElement | null>(null);
	let syncMedia = $state<(() => void) | null>(null);

	function gainAt(time: number): number {
		const points = entry.gainPoints.toSorted((left, right) => left.whenSeconds - right.whenSeconds);
		let base = points[0]?.value ?? 1;
		for (let index = 1; index < points.length; index++) {
			const right = points[index]!;
			if (time > right.whenSeconds) {
				base = right.value;
				continue;
			}
			const left = points[index - 1]!;
			const duration = right.whenSeconds - left.whenSeconds;
			const progress = duration > 0 ? (time - left.whenSeconds) / duration : 1;
			base = left.value + (right.value - left.value) * Math.min(1, Math.max(0, progress));
			break;
		}
		let transition = 1;
		for (const span of entry.transitionGainSpans) {
			if (time < span.startSeconds || time > span.startSeconds + span.durationSeconds) continue;
			transition *= transitionGainAtProgress(
				(time - span.startSeconds) / span.durationSeconds,
				span.isIncoming,
				span.dipToSilence
			);
		}
		return clampMonitorVolume(
			base * transition * previewPlaybackSettings.volume * (previewPlaybackSettings.muted ? 0 : 1)
		);
	}

	$effect(() => {
		const media = audio;
		if (!media) return;
		const scheduler = new SeekScheduler((target) => (media.currentTime = target));
		const sync = () => {
			const time = untrack(() => timelineStore.currentFrame) / editorSession.fps;
			const sourceTime =
				entry.sourceOffsetSeconds +
				(time - entry.whenSeconds) * entry.playbackRate * (entry.reversed ? -1 : 1);
			if (seekDriftExceeded(media.currentTime, sourceTime, 0.08 / entry.playbackRate)) {
				scheduler.request(sourceTime);
			}
			media.playbackRate = Math.min(16, Math.max(0.0625, entry.playbackRate));
			media.volume = gainAt(time);
			if (editorSession.clock.isPlaying && media.paused && !entry.reversed)
				void media.play().catch(() => undefined);
			if (entry.reversed && !media.paused) media.pause();
			if (!editorSession.clock.isPlaying && !media.paused) media.pause();
		};
		syncMedia = sync;
		sync();
		const offPlay = editorSession.clock.on('play', sync);
		const offPause = editorSession.clock.on('pause', sync);
		return () => {
			offPlay();
			offPause();
			scheduler.detach();
			if (syncMedia === sync) syncMedia = null;
		};
	});

	$effect(() => {
		const frame = timelineStore.currentFrame;
		const sync = syncMedia;
		if (frame >= 0) sync?.();
	});
</script>

{#if url}
	<!-- svelte-ignore a11y_media_has_caption -- nested sequence audio has no visual caption -->
	<audio bind:this={audio} src={url}></audio>
{/if}
