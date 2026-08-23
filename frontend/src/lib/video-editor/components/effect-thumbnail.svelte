<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { CssFilterType } from '$lib/video-editor/effects/types';
	import type { EffectTemplate } from '$lib/video-editor/timeline/effect-drop';
	import {
		EFFECT_PREVIEW_HEIGHT,
		EFFECT_PREVIEW_WIDTH,
		ensureEffectPreviewPipeline,
		getEffectPreviewSample,
		renderEffectPreviewFrame
	} from '$lib/video-editor/effects/preview/effect-preview-engine';

	let {
		effectId,
		cssEffect,
		cssAmount,
		effects,
		viewport,
		active = false,
		class: className = ''
	}: {
		effectId?: string;
		cssEffect?: CssFilterType;
		cssAmount?: number;
		effects?: readonly EffectTemplate[];
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
	let destroyed = false;

	function draw(strength: number): void {
		if (destroyed) return;
		if (!canvas || !sample) return;
		const context = canvas.getContext('2d');
		if (!context) return;
		context.clearRect(0, 0, canvas.width, canvas.height);

		const templates: readonly EffectTemplate[] =
			effects ??
			(effectId
				? [{ kind: 'gpu', effectId }]
				: cssEffect && cssAmount !== undefined
					? [{ kind: 'css', effectType: cssEffect, amount: cssAmount }]
					: []);
		const frame = renderEffectPreviewFrame(sample, templates, strength);
		context.drawImage(frame.canvas, 0, 0, canvas.width, canvas.height);
		rendered = true;
		renderMode = frame.mode;
	}

	async function loadAndDraw(): Promise<void> {
		if (destroyed) return;
		const hasGpu =
			effectId !== undefined || effects?.some((effect) => effect.kind === 'gpu') === true;
		const loaded = await getEffectPreviewSample();
		if (destroyed || !visible || !loaded) return;
		sample = loaded;
		draw(1);
		if (hasGpu) {
			await ensureEffectPreviewPipeline();
			if (!destroyed && visible) draw(1);
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
		destroyed = true;
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
