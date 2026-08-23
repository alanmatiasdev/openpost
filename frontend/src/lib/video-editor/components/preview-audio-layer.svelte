<!-- Audio-only preview layer synchronized to the editor clock. -->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { resolveAnimatedItemAt } from '$lib/video-editor/timeline/animated-properties';
	import { SeekScheduler, seekDriftExceeded } from '$lib/video-editor/preview/seek-throttle';
	import { previewPlaybackSettings } from '$lib/video-editor/preview/playback-settings.svelte';
	import {
		previewItemVolume,
		previewItemVolumeWithFade
	} from '$lib/video-editor/preview/playback-settings';
	import { audioCrossfadeGainAtFrame } from '$lib/video-editor/audio/transition-crossfade';
	import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions.svelte';
	import { frameToSourceSeconds } from '$lib/video-editor/media/render-plan';
	import {
		previewAudioContext,
		reversedPreviewAudio
	} from '$lib/video-editor/audio/reverse-preview-audio';

	let { item, url }: { item: TimelineItem; url?: string | null } = $props();
	let audio = $state<HTMLAudioElement | null>(null);
	let reverseBuffer = $state<AudioBuffer | null>(null);
	let reverseSource: AudioBufferSourceNode | null = null;
	let reverseGain: GainNode | null = null;
	let reverseStartedAt = 0;
	let reverseStartedOffset = 0;
	const resolved = $derived(resolveAnimatedItemAt(item, timelineStore.currentFrame));
	const baseVolume = $derived(
		previewItemVolume(
			resolved,
			timelineStore.tracks,
			previewPlaybackSettings.volume,
			previewPlaybackSettings.muted
		)
	);
	const crossfadeGain = $derived(
		audioCrossfadeGainAtFrame(
			resolved,
			timelineStore.currentFrame,
			transitionsStore.list,
			timelineStore.itemById
		)
	);
	const volume = $derived(previewItemVolumeWithFade(baseVolume, crossfadeGain));

	function stopReverseSource(): void {
		if (!reverseSource) return;
		reverseSource.onended = null;
		try {
			reverseSource.stop();
		} catch {
			// A source can finish between the guard and stop call.
		}
		reverseSource.disconnect();
		reverseSource = null;
	}

	function startReverseSource(offsetSeconds: number, speed: number): void {
		const buffer = reverseBuffer;
		if (!buffer || offsetSeconds >= buffer.duration) {
			stopReverseSource();
			return;
		}
		stopReverseSource();
		const context = previewAudioContext();
		const source = context.createBufferSource();
		const gain = context.createGain();
		source.buffer = buffer;
		source.playbackRate.value = speed;
		gain.gain.value = volume;
		source.connect(gain).connect(context.destination);
		source.onended = () => {
			if (reverseSource === source) reverseSource = null;
		};
		reverseSource = source;
		reverseGain = gain;
		reverseStartedOffset = offsetSeconds;
		void context
			.resume()
			.then(() => {
				if (reverseSource !== source) return;
				reverseStartedAt = context.currentTime;
				source.start(0, offsetSeconds);
			})
			.catch(() => {
				if (reverseSource === source) reverseSource = null;
			});
	}

	$effect(() => {
		if (reverseGain) reverseGain.gain.value = volume;
	});

	$effect(() => {
		const sourceUrl = url;
		if (!item.isReversed || !sourceUrl) {
			reverseBuffer = null;
			stopReverseSource();
			return;
		}
		const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : editorSession.fps;
		const startSeconds = (item.sourceStart ?? 0) / sourceFps;
		const endSeconds =
			(item.sourceEnd ??
				(item.sourceStart ?? 0) +
					(item.durationInFrames / editorSession.fps) * (item.speed ?? 1) * sourceFps) / sourceFps;
		let stale = false;
		void reversedPreviewAudio(sourceUrl, startSeconds, endSeconds).then((buffer) => {
			if (!stale) reverseBuffer = buffer;
		});
		return () => {
			stale = true;
			stopReverseSource();
		};
	});

	$effect(() => {
		const media = audio;
		if (!media) return;
		const scheduler = new SeekScheduler((target) => {
			media.currentTime = target;
		});
		const sync = () => {
			const frame = untrack(() => timelineStore.currentFrame);
			const speed = item.speed ?? 1;
			if (item.isReversed) {
				if (!media.paused) media.pause();
				if (!editorSession.clock.isPlaying) {
					stopReverseSource();
					return;
				}
				const expectedOffset = Math.max(0, ((frame - item.from) / editorSession.fps) * speed);
				const context = previewAudioContext();
				const actualOffset = reverseSource
					? reverseStartedOffset + (context.currentTime - reverseStartedAt) * speed
					: Number.POSITIVE_INFINITY;
				if (Math.abs(actualOffset - expectedOffset) > 0.08) {
					startReverseSource(expectedOffset, speed);
				}
				return;
			}
			const sourceTime = frameToSourceSeconds(item, frame, editorSession.fps);
			if (seekDriftExceeded(media.currentTime, sourceTime, 0.08 / Math.max(0.1, speed))) {
				scheduler.request(sourceTime);
			}
			media.playbackRate = Math.min(16, Math.max(0.0625, speed));
			if (editorSession.clock.isPlaying && media.paused && !item.isReversed)
				void media.play().catch(() => undefined);
			if (item.isReversed && !media.paused) media.pause();
			if (!editorSession.clock.isPlaying && !media.paused) media.pause();
		};
		sync();
		const offFrame = editorSession.clock.on('framechange', sync);
		const offPlay = editorSession.clock.on('play', sync);
		const offPause = editorSession.clock.on('pause', sync);
		return () => {
			offFrame();
			offPlay();
			offPause();
			scheduler.detach();
			stopReverseSource();
		};
	});
</script>

{#if url}
	<!-- svelte-ignore a11y_media_has_caption -- audio-only timeline media has no visual caption -->
	<audio bind:this={audio} src={url} {volume}></audio>
{/if}
