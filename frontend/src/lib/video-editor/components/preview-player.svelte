<!-- Preview player: pooled <video> synced to the session clock -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { untrack } from 'svelte';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { activeValueAt } from '$lib/video-editor/timeline/actions/keyframes';
	import { effectsToCssFilter } from '$lib/video-editor/effects/filter';
	import { getMediaObjectUrl, revokeMediaObjectUrl } from '$lib/video-editor/media/media-source';
	import {
		incomingOpacity,
		outgoingOpacity,
		transitionsStore,
		transitionAtFrame
	} from '$lib/video-editor/timeline/actions/transitions.svelte';
	import {
		createGpuCompositor,
		type GpuCompositor
	} from '$lib/video-editor/effects/gpu/compositor';
	import { getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
	import { isNonNormalBlend } from '$lib/video-editor/effects/gpu/blend-modes';
	import type { GpuRenderEffect } from '$lib/video-editor/effects/gpu/compositor';
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import {
		SeekScheduler,
		seekDriftExceeded,
		supportsVideoFrameCallback
	} from '$lib/video-editor/preview/seek-throttle';

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

	// ── GPU pipeline ────────────────────────────────────────────────────────
	// When the active clip carries enabled GPU effects or a non-normal blend
	// mode (and no transition is blending), the frame composites through the
	// WebGL2 canvas layered over the <video>; the DOM path stays untouched
	// otherwise and remains the fallback when WebGL2 is unavailable.

	let gpuCanvasEl = $state<HTMLCanvasElement | null>(null);
	let compositor = $state<GpuCompositor | null>(null);

	const gpuRenderEffects = $derived.by<GpuRenderEffect[]>(() => {
		const item = activeItem;
		if (!item) return [];
		return (item.effects ?? []).flatMap((effect) => {
			if (effect.type !== 'gpu' || !effect.enabled) return [];
			return [
				{
					effectId: effect.effectId,
					params: { ...getGpuEffectDefaultParams(effect.effectId), ...effect.params }
				}
			];
		});
	});

	const needsGpu = $derived(
		!!activeItem &&
			!blend &&
			(gpuRenderEffects.length > 0 || isNonNormalBlend(activeItem?.blendMode))
	);

	$effect(() => {
		const canvas = gpuCanvasEl;
		if (!canvas || !needsGpu) return;
		const instance = createGpuCompositor(canvas);
		if (!instance) return;
		compositor = instance;
		return () => {
			instance.dispose();
			if (compositor === instance) compositor = null;
		};
	});

	// rAF-driven composite while playing; framechange redraw covers scrubbing.
	$effect(() => {
		const instance = compositor;
		const video = videoEl;
		const canvas = gpuCanvasEl;
		const item = activeItem;
		if (!needsGpu || !instance || !video || !canvas || !item) return;

		const draw = () => {
			const width = video.videoWidth;
			const height = video.videoHeight;
			if (!width || !height) return;
			const rendered = instance.render(video, width, height, gpuRenderEffects, {
				time: timelineStore.currentFrame / editorSession.fps,
				blendMode: item.blendMode ?? 'normal'
			});
			canvas.style.visibility = rendered ? 'visible' : 'hidden';
			video.style.visibility = rendered ? 'hidden' : '';
			// Keyframed opacity applies to the composited surface.
			const keyframedOpacity = activeValueAt(item, 'opacity', timelineStore.currentFrame);
			canvas.style.opacity = String(keyframedOpacity ?? 1);
		};

		draw();
		const offFrame = editorSession.clock.on('framechange', () => requestAnimationFrame(draw));
		let raf = 0;
		const loop = () => {
			draw();
			raf = requestAnimationFrame(loop);
		};
		if (editorSession.clock.isPlaying) raf = requestAnimationFrame(loop);
		const offPlay = editorSession.clock.on('play', () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(loop);
		});
		const offPause = editorSession.clock.on('pause', () => cancelAnimationFrame(raf));
		return () => {
			offPlay();
			offPause();
			offFrame();
			cancelAnimationFrame(raf);
			canvas.style.visibility = '';
			video.style.visibility = '';
		};
	});

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

	// Sync <video> to clock. Ported from FreeCut (MIT): seeks are coalesced
	// through SeekScheduler instead of writing currentTime on every frame
	// change, and while playing, drift is corrected against presented frames
	// via requestVideoFrameCallback (rAF fallback). The effect intentionally
	// reads currentFrame untracked so listeners are not torn down every frame.
	$effect(() => {
		const item = activeItem;
		const url = activeUrl;
		const video = videoEl;
		if (!item || !url || !video) return;

		const fps = editorSession.fps;
		const speed = item.speed ?? 1;
		const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : fps;
		const tolerance = 0.08 / Math.abs(speed || 1);

		const scheduler = new SeekScheduler((target) => {
			video.currentTime = target;
		});

		const sync = () => {
			const frame = untrack(() => timelineStore.currentFrame);
			const relativeFrame = frame - item.from;
			const sourceSeconds = (item.sourceStart ?? 0) / sourceFps + (relativeFrame / fps) * speed;

			if (seekDriftExceeded(video.currentTime, sourceSeconds, tolerance)) {
				scheduler.request(sourceSeconds);
			}
			video.playbackRate = Math.min(16, Math.max(0.0625, speed));
			if (editorSession.clock.isPlaying) {
				if (video.paused) void video.play().catch(() => undefined);
			} else if (!video.paused) {
				video.pause();
			}

			// Keyframed opacity applies to the active layer.
			const keyframedOpacity = activeValueAt(item, 'opacity', frame);
			if (keyframedOpacity !== null) {
				video.style.opacity = String(keyframedOpacity);
			} else if (!blend || !outVideoEl) {
				video.style.opacity = '';
			}
		};

		let stopPresentationLoop = () => {};
		const startPresentationLoop = () => {
			stopPresentationLoop();
			if (supportsVideoFrameCallback(video)) {
				let alive = true;
				const tick = () => {
					if (!alive) return;
					sync();
					if (alive && editorSession.clock.isPlaying && videoEl === video) {
						video.requestVideoFrameCallback(tick);
					} else {
						alive = false;
					}
				};
				video.requestVideoFrameCallback(tick);
				stopPresentationLoop = () => {
					alive = false;
				};
			} else {
				let raf = requestAnimationFrame(function loop() {
					sync();
					if (editorSession.clock.isPlaying && videoEl === video) {
						raf = requestAnimationFrame(loop);
					}
				});
				stopPresentationLoop = () => cancelAnimationFrame(raf);
			}
		};

		sync();
		if (untrack(() => editorSession.clock.isPlaying)) startPresentationLoop();

		const offFrame = editorSession.clock.on('framechange', () => {
			// Scrubbing/stepping while paused: one throttled seek per frame event.
			if (!editorSession.clock.isPlaying) sync();
		});
		const offPlay = editorSession.clock.on('play', startPresentationLoop);
		const offPause = editorSession.clock.on('pause', () => {
			stopPresentationLoop();
			video.pause();
		});
		return () => {
			offPlay();
			offPause();
			offFrame();
			stopPresentationLoop();
			scheduler.detach();
		};
	});
</script>

<div class="flex min-h-0 flex-1 items-center justify-center bg-[oklch(0.12_0.008_55)] p-4">
	<div class="relative max-h-full max-w-full" style="aspect-ratio: {aspect};">
		{#if activeUrl}
			{#key activeUrl}
				<!-- svelte-ignore a11y_media_has_caption -- editor preview canvas; captions render as subtitle items -->
				<video
					bind:this={videoEl}
					src={activeUrl}
					class="max-h-full rounded-md"
					style:filter={activeItem ? effectsToCssFilter(activeItem.effects) : ''}
					playsinline
				></video>
			{/key}
			{#if needsGpu}
				<canvas
					bind:this={gpuCanvasEl}
					class="absolute inset-0 h-full w-full rounded-md"
					style:filter={activeItem ? effectsToCssFilter(activeItem.effects) : ''}
				></canvas>
			{/if}
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
