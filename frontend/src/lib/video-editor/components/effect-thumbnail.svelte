<script lang="ts">
	import { onDestroy } from 'svelte';
	import { getGpuEffect } from '$lib/video-editor/effects/gpu/registry';
	import type { GpuParamValues } from '$lib/video-editor/effects/gpu/types';
	import type { CssFilterType } from '$lib/video-editor/effects/types';
	import {
		cssPreviewFilter,
		EFFECT_PREVIEW_HEIGHT,
		EFFECT_PREVIEW_WIDTH,
		ensureEffectPreviewPipeline,
		getEffectPreviewSample,
		getShowcaseParams,
		renderGpuEffectPreview
	} from '$lib/video-editor/effects/preview/effect-preview-engine';

	let {
		effectId,
		cssEffect,
		cssAmount,
		viewport,
		active = false,
		class: className = ''
	}: {
		effectId?: string;
		cssEffect?: CssFilterType;
		cssAmount?: number;
		viewport?: HTMLElement | null;
		active?: boolean;
		class?: string;
	} = $props();

	let canvas = $state<HTMLCanvasElement>();
	let sample = $state<HTMLCanvasElement | OffscreenCanvas | null>(null);
	let visible = $state(false);
	let rendered = $state(false);
	let renderMode = $state<'gpu' | 'css' | 'fallback'>('fallback');
	let animationFrame = 0;
	let observer: IntersectionObserver | null = null;

	function draw(strength: number): void {
		if (!canvas || !sample) return;
		const context = canvas.getContext('2d');
		if (!context) return;
		context.clearRect(0, 0, canvas.width, canvas.height);

		const definition = effectId ? getGpuEffect(effectId) : undefined;
		if (effectId && definition) {
			const target: GpuParamValues = getShowcaseParams(definition);
			const output = renderGpuEffectPreview(sample, effectId, target, strength);
			if (output) {
				context.drawImage(output, 0, 0, canvas.width, canvas.height);
				rendered = true;
				renderMode = 'gpu';
				return;
			}
		}

		if (cssEffect && cssAmount !== undefined) {
			context.save();
			context.filter = cssPreviewFilter(cssEffect, cssAmount, strength);
			context.drawImage(sample, 0, 0, canvas.width, canvas.height);
			context.restore();
			rendered = true;
			renderMode = 'css';
			return;
		}

		context.drawImage(sample, 0, 0, canvas.width, canvas.height);
		rendered = true;
		renderMode = 'fallback';
	}

	async function loadAndDraw(): Promise<void> {
		const loaded = await getEffectPreviewSample();
		if (!visible || !loaded) return;
		sample = loaded;
		draw(1);
		if (effectId) {
			await ensureEffectPreviewPipeline();
			if (visible) draw(1);
		}
	}

	function stopAnimation(): void {
		if (animationFrame) cancelAnimationFrame(animationFrame);
		animationFrame = 0;
	}

	$effect(() => {
		const target = canvas;
		const root = viewport;
		observer?.disconnect();
		observer = null;
		if (!target) return;
		if (typeof IntersectionObserver === 'undefined') {
			visible = true;
			void loadAndDraw();
			return;
		}
		if (!root) return;
		observer = new IntersectionObserver(
			(entries) => {
				const nextVisible = entries.some((entry) => entry.isIntersecting);
				if (nextVisible && !visible) {
					visible = true;
					void loadAndDraw();
				} else if (!nextVisible) {
					visible = false;
					stopAnimation();
				}
			},
			{ root, rootMargin: '80px 0px' }
		);
		observer.observe(target);
		return () => observer?.disconnect();
	});

	$effect(() => {
		stopAnimation();
		if (!active || !visible || !sample) {
			if (visible && sample) draw(1);
			return;
		}
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
			draw(1);
			return;
		}
		let startedAt = 0;
		const tick = (now: number) => {
			if (!startedAt) startedAt = now;
			const phase = ((now - startedAt) % 2200) / 1100;
			draw(phase <= 1 ? phase : 2 - phase);
			animationFrame = requestAnimationFrame(tick);
		};
		animationFrame = requestAnimationFrame(tick);
	});

	onDestroy(() => {
		observer?.disconnect();
		stopAnimation();
	});
</script>

<canvas
	bind:this={canvas}
	width={EFFECT_PREVIEW_WIDTH}
	height={EFFECT_PREVIEW_HEIGHT}
	class={`bg-black/40 ${className}`}
	draggable="false"
	aria-hidden="true"
	data-rendered={rendered}
	data-render-mode={renderMode}
></canvas>
