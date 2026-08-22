<!-- One frame-synced visual layer in the composited editor preview. -->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { ItemTransform, TimelineItem } from '$lib/video-editor/project/types';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { resolveAnimatedItemAt } from '$lib/video-editor/timeline/animated-properties';
	import { effectsToCssFilter } from '$lib/video-editor/effects/filter';
	import { SeekScheduler, seekDriftExceeded } from '$lib/video-editor/preview/seek-throttle';
	import {
		createGpuCompositor,
		type GpuCompositor,
		type GpuRenderEffect
	} from '$lib/video-editor/effects/gpu/compositor';
	import { getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
	import { isNonNormalBlend } from '$lib/video-editor/effects/gpu/blend-modes';

	let {
		item,
		url,
		canvasWidth,
		canvasHeight,
		opacityMultiplier = 1,
		overrideTransform,
		onselect
	}: {
		item: TimelineItem;
		url?: string | null;
		canvasWidth: number;
		canvasHeight: number;
		opacityMultiplier?: number;
		overrideTransform?: ItemTransform;
		onselect: () => void;
	} = $props();
	let mediaElement = $state<HTMLVideoElement | null>(null);
	let gpuCanvas = $state<HTMLCanvasElement | null>(null);
	let compositor = $state<GpuCompositor | null>(null);
	const resolved = $derived(resolveAnimatedItemAt(item, timelineStore.currentFrame));
	const transform = $derived(overrideTransform ?? resolved.transform ?? {});
	const gpuEffects = $derived.by<GpuRenderEffect[]>(() =>
		(resolved.effects ?? []).flatMap((effect) =>
			effect.type === 'gpu' && effect.enabled
				? [
						{
							effectId: effect.effectId,
							params: { ...getGpuEffectDefaultParams(effect.effectId), ...effect.params }
						}
					]
				: []
		)
	);
	const needsGpu = $derived(
		resolved.type === 'video' && (gpuEffects.length > 0 || isNonNormalBlend(resolved.blendMode))
	);
	const layerStyle = $derived.by(() => {
		const width = transform.width ?? canvasWidth;
		const height = transform.height ?? canvasHeight;
		const anchorX = transform.anchorX ?? width / 2;
		const anchorY = transform.anchorY ?? height / 2;
		return [
			`left:${50 + ((transform.x ?? 0) / canvasWidth) * 100}%`,
			`top:${50 + ((transform.y ?? 0) / canvasHeight) * 100}%`,
			`width:${(width / canvasWidth) * 100}%`,
			`height:${(height / canvasHeight) * 100}%`,
			`transform:translate(${(-anchorX / width) * 100}%,${(-anchorY / height) * 100}%) rotate(${transform.rotation ?? 0}deg) scaleX(${transform.flipHorizontal ? -1 : 1}) scaleY(${transform.flipVertical ? -1 : 1})`,
			`opacity:${Math.max(0, Math.min(1, (transform.opacity ?? 1) * opacityMultiplier))}`,
			`border-radius:${(Math.max(0, transform.cornerRadius ?? 0) / canvasWidth) * 100}cqw`,
			`filter:${effectsToCssFilter(resolved.effects)}`
		].join(';');
	});

	$effect(() => {
		const video = mediaElement;
		if (!video || item.type !== 'video') return;
		const scheduler = new SeekScheduler((target) => {
			video.currentTime = target;
		});
		const sync = () => {
			const frame = untrack(() => timelineStore.currentFrame);
			const speed = item.speed ?? 1;
			const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : editorSession.fps;
			const sourceTime =
				(item.sourceStart ?? 0) / sourceFps + ((frame - item.from) / editorSession.fps) * speed;
			if (seekDriftExceeded(video.currentTime, sourceTime, 0.08 / Math.max(0.1, speed)))
				scheduler.request(sourceTime);
			video.playbackRate = Math.min(16, Math.max(0.0625, speed));
			if (editorSession.clock.isPlaying && video.paused) void video.play().catch(() => undefined);
			if (!editorSession.clock.isPlaying && !video.paused) video.pause();
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
		};
	});

	$effect(() => {
		const canvas = gpuCanvas;
		if (!canvas || !needsGpu) return;
		const instance = createGpuCompositor(canvas);
		if (!instance) return;
		compositor = instance;
		return () => {
			instance.dispose();
			if (compositor === instance) compositor = null;
		};
	});

	$effect(() => {
		const video = mediaElement;
		const canvas = gpuCanvas;
		const instance = compositor;
		if (!video || !canvas || !instance || !needsGpu) return;
		const draw = () => {
			if (!video.videoWidth || !video.videoHeight) return;
			const rendered = instance.render(video, video.videoWidth, video.videoHeight, gpuEffects, {
				time: timelineStore.currentFrame / editorSession.fps,
				blendMode: resolved.blendMode ?? 'normal'
			});
			canvas.hidden = !rendered;
			video.style.visibility = rendered ? 'hidden' : '';
		};
		draw();
		const offFrame = editorSession.clock.on('framechange', () => requestAnimationFrame(draw));
		const offPlay = editorSession.clock.on('play', draw);
		return () => {
			offFrame();
			offPlay();
			video.style.visibility = '';
		};
	});
</script>

<div
	class="absolute overflow-hidden"
	style={layerStyle}
	role="presentation"
	onpointerdown={onselect}
>
	{#if resolved.type === 'video' && url}
		<!-- svelte-ignore a11y_media_has_caption -- captions render as separate layers -->
		<video bind:this={mediaElement} src={url} class="size-full object-fill" playsinline></video>
		{#if needsGpu}<canvas bind:this={gpuCanvas} class="absolute inset-0 size-full" hidden
			></canvas>{/if}
	{:else if resolved.type === 'image' && url}
		<img src={url} alt="" class="size-full object-fill" />
	{:else if resolved.type === 'text'}
		<div
			class="flex size-full whitespace-pre-wrap"
			style:color={resolved.color ?? '#ffffff'}
			style:background={resolved.backgroundColor ?? 'transparent'}
			style:font-family={resolved.fontFamily ?? 'sans-serif'}
			style:font-size={`${((resolved.fontSize ?? 48) / canvasHeight) * 100}cqh`}
			style:font-weight={resolved.fontWeight ?? 600}
			style:line-height={resolved.lineHeight ?? 1.2}
			style:letter-spacing={`${resolved.letterSpacing ?? 0}px`}
			style:justify-content={resolved.textAlign === 'left'
				? 'flex-start'
				: resolved.textAlign === 'right'
					? 'flex-end'
					: 'center'}
			style:align-items={resolved.verticalAlign === 'top'
				? 'flex-start'
				: resolved.verticalAlign === 'bottom'
					? 'flex-end'
					: 'center'}
			style:padding={`${resolved.paddingY ?? 0}px ${resolved.paddingX ?? 0}px`}
		>
			{resolved.text ?? resolved.label}
		</div>
	{/if}
</div>
