<script lang="ts">
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import { Slider } from '$lib/components/ui/slider';
	import { getGpuEffect, getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
	import { gpuEffectLabel, gpuParamLabel } from '$lib/video-editor/effects/gpu/i18n';
	import type { GpuEffect } from '$lib/video-editor/effects/types';
	import { colorPreviewStore } from '$lib/video-editor/effects/color-preview-store.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { upsertGpuEffectParamsOnItems } from '$lib/video-editor/timeline/actions/effects';

	const EFFECT_ID = 'gpu-color-wheels';
	const defaults = getGpuEffectDefaultParams(EFFECT_ID);
	const definition = getGpuEffect(EFFECT_ID)!;

	const wheelDescriptors = [
		{ hue: 'shadowsHue', amount: 'shadowsAmount', level: 'lift' },
		{ hue: 'midtonesHue', amount: 'midtonesAmount', level: 'gamma' },
		{ hue: 'highlightsHue', amount: 'highlightsAmount', level: 'gain' },
		{ hue: 'offsetHue', amount: 'offsetAmount', level: 'offset' }
	] as const;

	const topParameters = ['temperature', 'tint', 'contrast', 'pivot', 'midDetail'] as const;
	const bottomParameters = [
		'colorBoost',
		'shadows',
		'highlights',
		'saturation',
		'hue',
		'lumMix'
	] as const;

	let {
		itemId,
		itemIds = [],
		onedit
	}: { itemId: string | null; itemIds?: string[]; onedit: () => void } = $props();

	let wheelDrafts = $state<Record<string, { hue: number; amount: number }>>({});
	let parameterDrafts = $state<Record<string, number>>({});
	let pointerWheel = $state<string | null>(null);

	const item = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);
	const wheelEffect = $derived(
		item?.effects?.find(
			(effect): effect is GpuEffect => effect.type === 'gpu' && effect.effectId === EFFECT_ID
		)
	);
	const targetItemIds = $derived.by(() => {
		const requested = itemId && itemIds.includes(itemId) ? itemIds : itemId ? [itemId] : [];
		return [...new Set(requested)].filter((id) => timelineStore.itemById.get(id)?.type !== 'audio');
	});

	function schema(name: string) {
		return definition?.schema.find((entry) => entry.name === name);
	}

	function label(name: string): string {
		const param = schema(name);
		return param ? gpuParamLabel(param) : name;
	}

	function read(name: string): number {
		return Number(wheelEffect?.params[name] ?? defaults[name] ?? 0);
	}

	function wheelValue(descriptor: (typeof wheelDescriptors)[number]): {
		hue: number;
		amount: number;
	} {
		return (
			wheelDrafts[descriptor.hue] ?? {
				hue: read(descriptor.hue),
				amount: read(descriptor.amount)
			}
		);
	}

	function parameterValue(name: string): number {
		return parameterDrafts[name] ?? read(name);
	}

	function preview(updates: Record<string, number>): void {
		if (!itemId || !wheelEffect) return;
		const effectIds = targetItemIds.flatMap((id) => {
			const effect = timelineStore.itemById
				.get(id)
				?.effects?.find(
					(candidate) => candidate.type === 'gpu' && candidate.effectId === EFFECT_ID
				);
			return effect?.type === 'gpu' ? [effect.id] : [];
		});
		colorPreviewStore.setEffectDraft(itemId, wheelEffect, updates, effectIds);
	}

	function commit(updates: Record<string, number>): void {
		if (!itemId) return;
		colorPreviewStore.clearEffectDraft(itemId);
		if (upsertGpuEffectParamsOnItems(targetItemIds, EFFECT_ID, updates)) onedit();
	}

	function pointFromPointer(event: PointerEvent): { hue: number; amount: number } {
		const bounds = event.currentTarget.getBoundingClientRect();
		const centerX = bounds.left + bounds.width / 2;
		const centerY = bounds.top + bounds.height / 2;
		const x = event.clientX - centerX;
		const y = event.clientY - centerY;
		const radius = Math.max(1, bounds.width / 2 - 8);
		return {
			hue: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
			amount: Math.max(0, Math.min(1, Math.hypot(x, y) / radius))
		};
	}

	function updateWheel(event: PointerEvent, descriptor: (typeof wheelDescriptors)[number]): void {
		if (pointerWheel !== descriptor.hue) return;
		const value = pointFromPointer(event);
		wheelDrafts[descriptor.hue] = value;
		preview({ [descriptor.hue]: value.hue, [descriptor.amount]: value.amount });
	}

	function startWheel(event: PointerEvent, descriptor: (typeof wheelDescriptors)[number]): void {
		if (event.button !== 0 || pointerWheel) return;
		event.preventDefault();
		pointerWheel = descriptor.hue;
		event.currentTarget.setPointerCapture?.(event.pointerId);
		updateWheel(event, descriptor);
	}

	function finishWheel(event: PointerEvent, descriptor: (typeof wheelDescriptors)[number]): void {
		if (pointerWheel !== descriptor.hue) return;
		updateWheel(event, descriptor);
		const value = wheelValue(descriptor);
		pointerWheel = null;
		commit({ [descriptor.hue]: value.hue, [descriptor.amount]: value.amount });
		delete wheelDrafts[descriptor.hue];
		if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	}

	function cancelWheel(event: PointerEvent, descriptor: (typeof wheelDescriptors)[number]): void {
		if (pointerWheel !== descriptor.hue) return;
		pointerWheel = null;
		delete wheelDrafts[descriptor.hue];
		if (itemId) colorPreviewStore.clearEffectDraft(itemId);
	}

	function changeWheelFromKeyboard(
		event: KeyboardEvent,
		descriptor: (typeof wheelDescriptors)[number]
	): void {
		const current = wheelValue(descriptor);
		let hue = current.hue;
		let amount = current.amount;
		if (event.key === 'ArrowLeft') hue -= event.shiftKey ? 10 : 1;
		else if (event.key === 'ArrowRight') hue += event.shiftKey ? 10 : 1;
		else if (event.key === 'ArrowDown') amount -= event.shiftKey ? 0.1 : 0.01;
		else if (event.key === 'ArrowUp') amount += event.shiftKey ? 0.1 : 0.01;
		else if (event.key === 'Home') amount = 0;
		else if (event.key === 'End') amount = 1;
		else return;
		event.preventDefault();
		hue = ((hue % 360) + 360) % 360;
		amount = Math.max(0, Math.min(1, amount));
		commit({ [descriptor.hue]: hue, [descriptor.amount]: amount });
	}

	function resetWheel(descriptor: (typeof wheelDescriptors)[number]): void {
		commit({
			[descriptor.hue]: Number(defaults[descriptor.hue] ?? 0),
			[descriptor.amount]: Number(defaults[descriptor.amount] ?? 0),
			[descriptor.level]: Number(defaults[descriptor.level] ?? 0)
		});
	}

	function updateParameter(name: string, value: number): void {
		parameterDrafts[name] = value;
		preview({ [name]: value });
	}

	function commitParameter(name: string, value: number): void {
		delete parameterDrafts[name];
		commit({ [name]: value });
	}

	function normalizeLevel(name: string, value: number): number {
		const param = schema(name);
		if (!param) return value;
		return Math.min(Number(param.max), Math.max(Number(param.min), value));
	}

	function ringFill(name: string): number {
		const param = schema(name);
		if (!param) return 0;
		const min = Number(param.min);
		const max = Number(param.max);
		return Math.max(0, Math.min(1, (read(name) - min) / Math.max(0.0001, max - min)));
	}
</script>

<section class="flex h-full min-h-0 flex-col" aria-label={gpuEffectLabel(definition)}>
	<header class="flex h-8 shrink-0 items-center justify-between border-b border-white/10 px-3">
		<h3 class="text-xs font-semibold">{gpuEffectLabel(definition)}</h3>
		<span class="font-mono text-[9px] tracking-wide text-white/35">PRIMARIES</span>
	</header>

	<div class="grid shrink-0 grid-cols-5 gap-2 border-b border-white/10 px-3 py-1">
		{#each topParameters as name (name)}
			{@const param = schema(name)}
			{#if param}
				<label class="grid min-w-0 grid-cols-[1fr_auto] items-center text-[8px] text-white/45">
					<span class="truncate">{gpuParamLabel(param)}</span>
					<output class="font-mono text-[8px] text-white/75">
						{parameterValue(name).toFixed(param.step < 0.1 ? 2 : 0)}
					</output>
					<Slider
						class="col-span-2 mt-0.5"
						min={param.min}
						max={param.max}
						step={param.step}
						value={parameterValue(name)}
						ariaLabel={gpuParamLabel(param)}
						onValueChange={(value) => updateParameter(name, value)}
						onValueCommit={(value) => commitParameter(name, value)}
					/>
				</label>
			{/if}
		{/each}
	</div>

	<div class="grid min-h-0 flex-1 grid-cols-4 items-center gap-2 overflow-hidden px-4 py-1.5">
		{#each wheelDescriptors as descriptor (descriptor.hue)}
			{@const value = wheelValue(descriptor)}
			{@const levelSchema = schema(descriptor.level)}
			<div class="flex min-h-0 min-w-0 flex-col items-center gap-0.5">
				<div class="flex h-4 items-center justify-center gap-0.5">
					<span class="truncate text-[10px] font-semibold">{label(descriptor.level)}</span>
					<button
						type="button"
						class="flex size-5 items-center justify-center rounded text-white/45 hover:bg-white/8 hover:text-white focus-visible:outline-2 focus-visible:outline-orange-400"
						aria-label={`Reset ${label(descriptor.level)}`}
						title={`Reset ${label(descriptor.level)}`}
						onclick={() => resetWheel(descriptor)}
					>
						<RotateCcwIcon class="size-3" />
					</button>
				</div>
				<button
					type="button"
					class="color-wheel relative aspect-square h-auto min-h-10 w-full max-w-24 touch-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
					style:--wheel-hue={`${value.hue}deg`}
					style:--wheel-amount={value.amount}
					style:--ring-fill={`${ringFill(descriptor.level) * 360}deg`}
					role="slider"
					aria-label={`${label(descriptor.level)} color wheel`}
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={Math.round(value.amount * 100)}
					aria-valuetext={`${Math.round(value.hue)} degrees, ${Math.round(value.amount * 100)} percent`}
					onpointerdown={(event) => startWheel(event, descriptor)}
					onpointermove={(event) => updateWheel(event, descriptor)}
					onpointerup={(event) => finishWheel(event, descriptor)}
					onpointercancel={(event) => cancelWheel(event, descriptor)}
					onkeydown={(event) => changeWheelFromKeyboard(event, descriptor)}
				>
					<span class="wheel-cross wheel-cross-x"></span>
					<span class="wheel-cross wheel-cross-y"></span>
					<span class="wheel-puck"></span>
				</button>
				{#if levelSchema}
					<label
						class="grid w-full grid-cols-[1fr_3rem] items-center gap-1 text-[8px] text-white/40"
					>
						<Slider
							min={levelSchema.min}
							max={levelSchema.max}
							step={levelSchema.step}
							value={parameterValue(descriptor.level)}
							ariaLabel={gpuParamLabel(levelSchema)}
							onValueChange={(next) => updateParameter(descriptor.level, next)}
							onValueCommit={(next) => commitParameter(descriptor.level, next)}
						/>
						<input
							type="number"
							class="h-6 rounded border border-white/10 bg-black/35 px-1 text-right font-mono text-[9px] text-white/80 outline-none focus:border-orange-400"
							min={levelSchema.min}
							max={levelSchema.max}
							step={levelSchema.step}
							value={parameterValue(descriptor.level).toFixed(levelSchema.step < 0.1 ? 2 : 0)}
							aria-label={`${gpuParamLabel(levelSchema)} value`}
							onchange={(event) =>
								commitParameter(
									descriptor.level,
									normalizeLevel(descriptor.level, Number(event.currentTarget.value))
								)}
						/>
					</label>
				{/if}
			</div>
		{/each}
	</div>

	<div class="grid shrink-0 grid-cols-6 gap-2 border-t border-white/10 px-3 py-1">
		{#each bottomParameters as name (name)}
			{@const param = schema(name)}
			{#if param}
				<label class="min-w-0 text-[8px] text-white/45">
					<span class="flex items-center justify-between gap-1">
						<span class="truncate">{gpuParamLabel(param)}</span>
						<output class="font-mono text-[8px] text-white/75">
							{parameterValue(name).toFixed(param.step < 0.1 ? 2 : 0)}
						</output>
					</span>
					<Slider
						class="mt-0.5"
						min={param.min}
						max={param.max}
						step={param.step}
						value={parameterValue(name)}
						ariaLabel={gpuParamLabel(param)}
						onValueChange={(value) => updateParameter(name, value)}
						onValueCommit={(value) => commitParameter(name, value)}
					/>
				</label>
			{/if}
		{/each}
	</div>
</section>

<style>
	.color-wheel {
		background:
			radial-gradient(
				circle closest-side,
				rgb(15 15 17 / 96%) 0%,
				rgb(15 15 17 / 90%) 57%,
				rgb(15 15 17 / 64%) 76%,
				transparent 88%
			),
			conic-gradient(
				from 90deg,
				#ff3b30,
				#ff9500,
				#ffcc00,
				#34c759,
				#00c7be,
				#007aff,
				#5856d6,
				#ff2d55,
				#ff3b30
			);
		box-shadow:
			0 0 0 4px #070708,
			0 0 0 8px rgb(220 220 228 / 55%);
	}

	.color-wheel::before {
		position: absolute;
		inset: -8px;
		border-radius: 999px;
		background: conic-gradient(#f4f4f6 var(--ring-fill), #050506 0);
		content: '';
		mask: radial-gradient(transparent 66%, black 68% 76%, transparent 78%);
		pointer-events: none;
	}

	.wheel-cross {
		position: absolute;
		background: rgb(255 255 255 / 14%);
		pointer-events: none;
	}

	.wheel-cross-x {
		top: 7%;
		bottom: 7%;
		left: 50%;
		width: 1px;
	}

	.wheel-cross-y {
		left: 7%;
		right: 7%;
		top: 50%;
		height: 1px;
	}

	.wheel-puck {
		position: absolute;
		left: calc(50% + cos(var(--wheel-hue)) * var(--wheel-amount) * 39%);
		top: calc(50% + sin(var(--wheel-hue)) * var(--wheel-amount) * 39%);
		width: 10px;
		height: 10px;
		translate: -50% -50%;
		border: 2px solid white;
		border-radius: 999px;
		background: hsl(var(--wheel-hue) 90% 58%);
		box-shadow: 0 1px 4px rgb(0 0 0 / 80%);
		pointer-events: none;
	}

	@media (pointer: coarse) {
		.color-wheel {
			min-width: 4.5rem;
			min-height: 4.5rem;
		}
	}
</style>
