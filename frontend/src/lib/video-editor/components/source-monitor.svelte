<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { showToast } from '$lib/toast';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { resolveMediaBlob } from '$lib/video-editor/media/import.svelte';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { LottieRenderer } from '$lib/video-editor/lottie/frame-provider';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		applySourceEdit,
		SourceEditError,
		type SourcePatchTarget
	} from '$lib/video-editor/source-monitor/source-edit';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import Music2Icon from '@lucide/svelte/icons/music-2';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SkipBackIcon from '@lucide/svelte/icons/skip-back';
	import XIcon from '@lucide/svelte/icons/x';

	let {
		mediaId,
		preferredTrackId,
		onclose,
		onedit,
		oninserted = () => undefined
	}: {
		mediaId: string;
		preferredTrackId?: string;
		onclose: () => void;
		onedit: () => void;
		oninserted?: (ids: string[]) => void;
	} = $props();

	const media = $derived(mediaPool.get(mediaId));
	const kind = $derived.by(() => {
		if (!media) return 'video';
		if (media.tags.includes('lottie')) return 'lottie';
		if (media.tags.includes('audio')) return 'audio';
		if (media.tags.includes('image')) return 'image';
		return 'video';
	});
	const sourceFps = $derived(Math.max(1, media?.fps || editorSession.fps));
	const durationFrames = $derived.by(() => {
		if (!media) return 1;
		if (kind === 'image') return Math.max(1, Math.round(editorSession.fps * 3));
		if (kind === 'lottie' && media.lottieTotalFrames) return Math.max(1, media.lottieTotalFrames);
		return Math.max(1, Math.round(media.duration * sourceFps));
	});
	const hasVideo = $derived(kind !== 'audio');
	const hasAudio = $derived(kind === 'audio' || (kind === 'video' && !!media?.audioCodec));
	const videoTracks = $derived(
		timelineStore.tracks.filter((track) => track.kind !== 'audio' && !track.locked)
	);
	const audioTracks = $derived(
		timelineStore.tracks.filter((track) => track.kind === 'audio' && !track.locked)
	);

	let sourceUrl = $state('');
	let loadError = $state('');
	let currentFrame = $state(0);
	let inPoint = $state(0);
	let outPoint = $state(1);
	let marksActive = $state(false);
	let initializedMediaId = $state('');
	let playing = $state(false);
	let showFrames = $state(false);
	let videoEnabled = $state(true);
	let audioEnabled = $state(true);
	let videoTarget = $state<SourcePatchTarget>('auto');
	let audioTarget = $state<SourcePatchTarget>('auto');
	let mediaElement = $state<HTMLMediaElement>();
	let lottieCanvas = $state<HTMLCanvasElement>();
	let lottieRenderer: LottieRenderer | null = null;
	let animationFrame = 0;
	let playbackStartedAt = 0;
	let playbackStartFrame = 0;
	let monitorElement = $state<HTMLElement>();
	let stripElement = $state<HTMLElement>();
	let rangeDragStartX = 0;
	let rangeDragStartIn = 0;
	let rangeDragStartOut = 1;

	const selectionLeft = $derived((inPoint / durationFrames) * 100);
	const selectionWidth = $derived(((outPoint - inPoint) / durationFrames) * 100);
	const displayPosition = $derived(showFrames ? `${currentFrame}f` : formatTimecode(currentFrame));
	const displayDuration = $derived(
		showFrames ? `${durationFrames}f` : formatTimecode(durationFrames)
	);

	$effect(() => {
		if (!media || initializedMediaId === media.id) return;
		initializedMediaId = media.id;
		currentFrame = 0;
		inPoint = 0;
		outPoint = durationFrames;
		marksActive = false;
		videoEnabled = hasVideo;
		audioEnabled = hasAudio;
		const preferredTrack = timelineStore.tracks.find((track) => track.id === preferredTrackId);
		if (preferredTrack?.kind === 'audio') audioTarget = preferredTrack.id;
		else if (preferredTrack) videoTarget = preferredTrack.id;
	});

	$effect(() => {
		if (initializedMediaId && !media) onclose();
	});

	$effect(() => {
		if (!media) return;
		let disposed = false;
		let objectUrl = '';
		loadError = '';
		void resolveMediaBlob(media)
			.then((blob) => {
				if (disposed) return;
				objectUrl = URL.createObjectURL(blob);
				sourceUrl = objectUrl;
			})
			.catch((error: unknown) => {
				if (!disposed) loadError = error instanceof Error ? error.message : String(error);
			});
		return () => {
			disposed = true;
			sourceUrl = '';
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	});

	$effect(() => {
		if (kind !== 'lottie' || !lottieCanvas || !sourceUrl) return;
		const renderer = new LottieRenderer(lottieCanvas, { src: sourceUrl, autoResize: true });
		lottieRenderer = renderer;
		void renderer.ready.then(() => renderer.renderFrame(currentFrame));
		return () => {
			if (lottieRenderer === renderer) lottieRenderer = null;
			renderer.destroy();
		};
	});

	$effect(() => {
		currentFrame;
		lottieRenderer?.renderFrame(currentFrame);
	});

	onDestroy(() => {
		cancelAnimationFrame(animationFrame);
		lottieRenderer?.destroy();
	});

	onMount(() => {
		window.addEventListener('keydown', handleKeydown, { capture: true });
		return () => window.removeEventListener('keydown', handleKeydown, { capture: true });
	});

	function formatTimecode(frame: number): string {
		const roundedFps = Math.max(1, Math.round(sourceFps));
		const totalSeconds = Math.floor(frame / sourceFps);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		const frames = Math.min(roundedFps - 1, Math.floor(frame % sourceFps));
		return [hours, minutes, seconds, frames]
			.map((value) => String(value).padStart(2, '0'))
			.join(':');
	}

	function clampFrame(frame: number): number {
		return Math.max(0, Math.min(Math.round(frame), durationFrames - 1));
	}

	function seek(frame: number, updateMedia = true): void {
		currentFrame = clampFrame(frame);
		if (updateMedia && mediaElement) {
			const time = currentFrame / sourceFps;
			if (Math.abs(mediaElement.currentTime - time) > 0.01) mediaElement.currentTime = time;
		}
	}

	function pause(): void {
		playing = false;
		cancelAnimationFrame(animationFrame);
		mediaElement?.pause();
	}

	function customPlaybackFrame(now: number): void {
		if (!playing) return;
		const next = playbackStartFrame + ((now - playbackStartedAt) / 1000) * sourceFps;
		if (next >= outPoint) {
			seek(outPoint - 1, false);
			pause();
			return;
		}
		seek(next, false);
		animationFrame = requestAnimationFrame(customPlaybackFrame);
	}

	async function togglePlayback(): Promise<void> {
		if (playing) {
			pause();
			return;
		}
		if (currentFrame < inPoint || currentFrame >= outPoint - 1) seek(inPoint);
		playing = true;
		if (mediaElement) {
			try {
				await mediaElement.play();
			} catch {
				playing = false;
			}
			return;
		}
		playbackStartFrame = currentFrame;
		playbackStartedAt = performance.now();
		animationFrame = requestAnimationFrame(customPlaybackFrame);
	}

	function updateFromMedia(): void {
		if (!mediaElement) return;
		const next = clampFrame(mediaElement.currentTime * sourceFps);
		if (next >= outPoint) {
			seek(outPoint - 1);
			pause();
			return;
		}
		currentFrame = next;
	}

	function markIn(): void {
		inPoint = Math.min(currentFrame, outPoint - 1);
		marksActive = true;
	}

	function markOut(): void {
		outPoint = Math.max(inPoint + 1, Math.min(durationFrames, currentFrame + 1));
		marksActive = true;
	}

	function clearMarks(): void {
		inPoint = 0;
		outPoint = durationFrames;
		marksActive = false;
	}

	function moveRange(delta: number): void {
		const length = rangeDragStartOut - rangeDragStartIn;
		const nextIn = Math.max(0, Math.min(durationFrames - length, rangeDragStartIn + delta));
		inPoint = Math.round(nextIn);
		outPoint = inPoint + length;
		seek(inPoint);
	}

	function startRangeDrag(event: PointerEvent): void {
		rangeDragStartX = event.clientX;
		rangeDragStartIn = inPoint;
		rangeDragStartOut = outPoint;
		(event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
	}

	function dragRange(event: PointerEvent): void {
		if (!(event.currentTarget as HTMLButtonElement).hasPointerCapture(event.pointerId)) return;
		const width = stripElement?.clientWidth ?? 0;
		if (width <= 0) return;
		moveRange(((event.clientX - rangeDragStartX) / width) * durationFrames);
	}

	function handleRangeKeydown(event: KeyboardEvent): void {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		rangeDragStartIn = inPoint;
		rangeDragStartOut = outPoint;
		moveRange(event.key === 'ArrowLeft' ? -1 : 1);
		event.preventDefault();
	}

	function edit(mode: 'insert' | 'overwrite'): void {
		if (!media) return;
		try {
			editorSession.pausePlayback();
			const result = applySourceEdit({
				media,
				inFrame: inPoint,
				outFrame: outPoint,
				insertFrame: timelineStore.currentFrame,
				videoEnabled,
				audioEnabled,
				videoTarget,
				audioTarget,
				createdVideoTrackName: m.video_editor_track_video_name({ number: videoTracks.length + 1 }),
				createdAudioTrackName: m.video_editor_track_audio_name({ number: audioTracks.length + 1 }),
				mode
			});
			oninserted(result.itemIds);
			onedit();
			showToast(
				mode === 'insert' ? m.video_editor_source_inserted() : m.video_editor_source_overwritten(),
				'success'
			);
		} catch (error) {
			showToast(sourceEditErrorMessage(error), 'error');
		}
	}

	function sourceEditErrorMessage(error: unknown): string {
		if (!(error instanceof SourceEditError)) return m.video_editor_source_edit_failed();
		if (error.code === 'target-locked') return m.video_editor_source_target_locked();
		if (error.code === 'target-invalid') return m.video_editor_source_target_invalid();
		if (error.code === 'no-patch') return m.video_editor_source_no_patch();
		return m.video_editor_source_edit_failed();
	}

	function handleKeydown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement;
		if (target.matches('input, select, textarea, button')) {
			if (monitorElement?.contains(target)) event.stopImmediatePropagation();
			return;
		}
		const isGlobalEditShortcut = event.key === ',' || event.key === '.';
		const isLocal =
			!!monitorElement && (monitorElement.contains(target) || monitorElement.matches(':hover'));
		if (!isGlobalEditShortcut && !isLocal) return;
		if (event.altKey && event.key.toLowerCase() === 'x') {
			clearMarks();
		} else if (event.key === ' ') {
			void togglePlayback();
		} else if (event.key.toLowerCase() === 'i') {
			markIn();
		} else if (event.key.toLowerCase() === 'o') {
			markOut();
		} else if (event.key === ',') {
			edit('insert');
		} else if (event.key === '.') {
			edit('overwrite');
		} else if (event.key === 'ArrowLeft') {
			pause();
			seek(currentFrame - 1);
		} else if (event.key === 'ArrowRight') {
			pause();
			seek(currentFrame + 1);
		} else {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
	}
</script>

<section
	bind:this={monitorElement}
	class="flex min-h-0 min-w-0 flex-1 flex-col border-r border-[oklch(0.25_0.015_55)] bg-[oklch(0.115_0.008_55)]"
	aria-label={m.video_editor_source_monitor()}
>
	<header class="flex h-9 shrink-0 items-center gap-2 border-b border-[oklch(0.23_0.012_55)] px-3">
		<span class="text-[10px] font-semibold tracking-widest text-[oklch(0.67_0.015_55)] uppercase">
			{m.video_editor_source_monitor()}
		</span>
		<span class="min-w-0 flex-1 truncate text-xs text-[oklch(0.82_0.012_55)]">
			{media?.fileName ?? m.video_editor_source_missing()}
		</span>
		<button
			type="button"
			class="rounded p-1 text-[oklch(0.68_0.015_55)] hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
			aria-label={m.video_editor_source_close()}
			onclick={onclose}
		>
			<XIcon class="size-3.5" aria-hidden="true" />
		</button>
	</header>

	<div class="relative flex min-h-32 flex-1 items-center justify-center overflow-hidden bg-black">
		{#if loadError}
			<p class="max-w-xs px-4 text-center text-xs text-red-300">{loadError}</p>
		{:else if !sourceUrl}
			<p class="text-xs text-[oklch(0.62_0.015_55)]">{m.video_editor_source_loading()}</p>
		{:else if kind === 'video'}
			<!-- svelte-ignore a11y_media_has_caption -- source media may not include a caption track -->
			<video
				bind:this={mediaElement}
				src={sourceUrl}
				class="size-full object-contain"
				preload="auto"
				onplay={() => (playing = true)}
				onpause={() => (playing = false)}
				onended={pause}
				ontimeupdate={updateFromMedia}
			></video>
		{:else if kind === 'audio'}
			<div class="flex flex-col items-center gap-3 text-[oklch(0.66_0.015_55)]">
				<Music2Icon class="size-10" aria-hidden="true" />
				<span class="text-xs">{m.video_editor_source_audio_only()}</span>
				<audio
					bind:this={mediaElement}
					src={sourceUrl}
					preload="auto"
					onplay={() => (playing = true)}
					onpause={() => (playing = false)}
					onended={pause}
					ontimeupdate={updateFromMedia}
				></audio>
			</div>
		{:else if kind === 'image'}
			<img src={sourceUrl} alt="" class="size-full object-contain" />
		{:else}
			<canvas bind:this={lottieCanvas} class="size-full object-contain"></canvas>
		{/if}
	</div>

	<div class="shrink-0 space-y-2 border-t border-[oklch(0.23_0.012_55)] p-2.5">
		<div class="flex items-center gap-2 font-mono text-[10px] text-[oklch(0.72_0.01_55)]">
			<button
				type="button"
				class="rounded bg-[oklch(0.18_0.01_55)] px-1.5 py-1 hover:text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
				onclick={() => (showFrames = !showFrames)}
				aria-label={showFrames
					? m.video_editor_source_show_timecode()
					: m.video_editor_source_show_frames()}
			>
				{displayPosition}
			</button>
			<span class="text-[oklch(0.48_0.01_55)]">/</span>
			<span>{displayDuration}</span>
			<span class="ml-auto">{sourceFps.toFixed(sourceFps % 1 === 0 ? 0 : 2)} fps</span>
		</div>

		<div bind:this={stripElement} class="relative h-5">
			<div class="absolute inset-x-0 top-2 h-1 rounded-full bg-[oklch(0.25_0.01_55)]"></div>
			{#if marksActive}
				<button
					type="button"
					class="absolute top-1.5 z-20 h-2 cursor-grab rounded-full bg-[oklch(0.66_0.14_45)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.82_0.13_55)] active:cursor-grabbing"
					style={`left:${selectionLeft}%;width:${selectionWidth}%`}
					aria-label={m.video_editor_source_move_range()}
					onpointerdown={startRangeDrag}
					onpointermove={dragRange}
					onkeydown={handleRangeKeydown}
				></button>
			{/if}
			<input
				class="source-scrubber absolute inset-0 z-10 w-full"
				type="range"
				min="0"
				max={durationFrames - 1}
				value={currentFrame}
				aria-label={m.video_editor_source_position()}
				oninput={(event) => {
					pause();
					seek(Number(event.currentTarget.value));
				}}
			/>
		</div>

		<div class="grid grid-cols-2 gap-2 text-[10px]">
			<label class="flex items-center gap-1.5 text-[oklch(0.68_0.015_55)]">
				<span class="w-4 font-semibold text-[oklch(0.82_0.012_55)]">I</span>
				<input
					class="min-w-0 flex-1 accent-[oklch(0.66_0.14_45)]"
					type="range"
					min="0"
					max={Math.max(0, outPoint - 1)}
					value={inPoint}
					aria-label={m.video_editor_source_in_point()}
					oninput={(event) => {
						inPoint = Number(event.currentTarget.value);
						marksActive = true;
					}}
				/>
				<span class="w-9 text-right font-mono">{inPoint}f</span>
			</label>
			<label class="flex items-center gap-1.5 text-[oklch(0.68_0.015_55)]">
				<span class="w-4 font-semibold text-[oklch(0.82_0.012_55)]">O</span>
				<input
					class="min-w-0 flex-1 accent-[oklch(0.66_0.14_45)]"
					type="range"
					min={inPoint + 1}
					max={durationFrames}
					value={outPoint}
					aria-label={m.video_editor_source_out_point()}
					oninput={(event) => {
						outPoint = Number(event.currentTarget.value);
						marksActive = true;
					}}
				/>
				<span class="w-9 text-right font-mono">{outPoint}f</span>
			</label>
		</div>

		<div class="flex flex-wrap items-center justify-center gap-1">
			<button
				class="transport-button"
				type="button"
				aria-label={m.video_editor_go_to_start()}
				onclick={() => seek(0)}
			>
				<SkipBackIcon class="size-3.5" aria-hidden="true" />
			</button>
			<button
				class="transport-button"
				type="button"
				aria-label={m.video_editor_step_back()}
				onclick={() => seek(currentFrame - 1)}
			>
				<ChevronLeftIcon class="size-3.5" aria-hidden="true" />
			</button>
			<button
				class="transport-button primary"
				type="button"
				aria-label={playing ? m.video_editor_pause() : m.video_editor_play()}
				onclick={() => void togglePlayback()}
			>
				{#if playing}<PauseIcon class="size-3.5" aria-hidden="true" />{:else}<PlayIcon
						class="size-3.5"
						aria-hidden="true"
					/>{/if}
			</button>
			<button
				class="transport-button"
				type="button"
				aria-label={m.video_editor_step_forward()}
				onclick={() => seek(currentFrame + 1)}
			>
				<ChevronRightIcon class="size-3.5" aria-hidden="true" />
			</button>
			<button class="mark-button" type="button" onclick={markIn}>{m.video_editor_mark_in()}</button>
			<button class="mark-button" type="button" onclick={markOut}
				>{m.video_editor_mark_out()}</button
			>
			<button class="mark-button" type="button" onclick={clearMarks}
				>{m.video_editor_source_clear_marks()}</button
			>
		</div>

		<div class="grid grid-cols-2 gap-2">
			<label class:disabled={!hasVideo} class="patch-row">
				<input type="checkbox" bind:checked={videoEnabled} disabled={!hasVideo} />
				<span class="patch-badge">V</span>
				<select
					bind:value={videoTarget}
					disabled={!videoEnabled || !hasVideo}
					aria-label={m.video_editor_source_video_target()}
				>
					<option value="auto">{m.video_editor_source_target_auto()}</option>
					{#each videoTracks as track (track.id)}<option value={track.id}>{track.name}</option
						>{/each}
					<option value="create">{m.video_editor_source_target_create()}</option>
				</select>
			</label>
			<label class:disabled={!hasAudio} class="patch-row">
				<input type="checkbox" bind:checked={audioEnabled} disabled={!hasAudio} />
				<span class="patch-badge">A</span>
				<select
					bind:value={audioTarget}
					disabled={!audioEnabled || !hasAudio}
					aria-label={m.video_editor_source_audio_target()}
				>
					<option value="auto">{m.video_editor_source_target_auto()}</option>
					{#each audioTracks as track (track.id)}<option value={track.id}>{track.name}</option
						>{/each}
					<option value="create">{m.video_editor_source_target_create()}</option>
				</select>
			</label>
		</div>

		<div class="grid grid-cols-2 gap-2">
			<button
				class="edit-button"
				type="button"
				disabled={!videoEnabled && !audioEnabled}
				onclick={() => edit('insert')}
			>
				<span>{m.video_editor_source_insert()}</span><kbd>,</kbd>
			</button>
			<button
				class="edit-button"
				type="button"
				disabled={!videoEnabled && !audioEnabled}
				onclick={() => edit('overwrite')}
			>
				<span>{m.video_editor_source_overwrite()}</span><kbd>.</kbd>
			</button>
		</div>
	</div>
</section>

<style>
	.source-scrubber {
		appearance: none;
		background: transparent;
	}
	.source-scrubber::-webkit-slider-thumb {
		appearance: none;
		width: 2px;
		height: 18px;
		border-radius: 1px;
		background: oklch(0.9 0.02 45);
		box-shadow: 0 0 0 1px oklch(0.1 0 0);
		cursor: ew-resize;
	}
	.transport-button,
	.mark-button,
	.edit-button {
		border-radius: 0.3rem;
		color: oklch(0.72 0.012 55);
		background: oklch(0.18 0.01 55);
	}
	.transport-button {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
	}
	.transport-button.primary {
		color: white;
		background: oklch(0.63 0.16 45);
	}
	.mark-button {
		padding: 0.38rem 0.48rem;
		font-size: 0.625rem;
	}
	.transport-button:hover,
	.mark-button:hover,
	.edit-button:hover:not(:disabled) {
		color: white;
		background: oklch(0.27 0.025 45);
	}
	.transport-button:focus-visible,
	.mark-button:focus-visible,
	.edit-button:focus-visible,
	.patch-row select:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 1px;
	}
	.patch-row {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.35rem;
		border-radius: 0.35rem;
		background: oklch(0.16 0.008 55);
		padding: 0.3rem;
	}
	.patch-row.disabled {
		opacity: 0.45;
	}
	.patch-row input {
		accent-color: oklch(0.66 0.14 45);
	}
	.patch-badge {
		font-size: 0.625rem;
		font-weight: 700;
		color: oklch(0.86 0.012 55);
	}
	.patch-row select {
		min-width: 0;
		flex: 1;
		border: 0;
		background: transparent;
		font-size: 0.625rem;
		color: oklch(0.72 0.012 55);
	}
	.edit-button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.45rem 0.6rem;
		font-size: 0.6875rem;
		font-weight: 600;
	}
	.edit-button:disabled {
		opacity: 0.45;
	}
	.edit-button kbd {
		font: inherit;
		color: oklch(0.55 0.01 55);
	}
</style>
