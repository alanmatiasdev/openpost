<!--
	Effects panel: per-clip effect stack — CSS-filter color/blur effects plus
	the GPU catalog (WebGL2 pipeline), and the clip's compositing blend mode.
	Sliders draft locally and commit one undoable update on release.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Slider } from '$lib/components/ui/slider';
	import AppSelect from '$lib/components/app-select.svelte';
	import XIcon from '@lucide/svelte/icons/x';
	import {
		EFFECT_DEFINITIONS,
		type GpuEffect,
		type ItemEffect,
		type ItemType
	} from '$lib/video-editor/effects/types';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		addEffect,
		addGpuEffect,
		removeEffect,
		setGpuEffectParam,
		setGpuEffectData,
		setItemBlendMode,
		updateEffect
	} from '$lib/video-editor/timeline/actions/effects';
	import {
		getGpuCategoriesWithEffects,
		getGpuEffect
	} from '$lib/video-editor/effects/gpu/registry';
	import {
		BLEND_MODE_GROUPS,
		ALL_BLEND_MODES,
		type BlendMode
	} from '$lib/video-editor/effects/gpu/blend-modes';
	import ColorScopes from './color-scopes.svelte';

	let { itemId, onedit }: { itemId: string | null; onedit: () => void } = $props();

	const item = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);
	const effects = $derived(item?.effects ?? []);

	/** In-flight slider values so dragging stays smooth before the undoable commit. */
	let draftAmounts = $state<Record<string, number>>({});
	let pendingKind = $state<string>('brightness');

	const typeLabels = $derived<Record<Exclude<ItemType, 'gpu'>, string>>({
		brightness: m.video_editor_effects_brightness(),
		contrast: m.video_editor_effects_contrast(),
		saturation: m.video_editor_effects_saturation(),
		'hue-rotate': m.video_editor_effects_hue_rotate(),
		sepia: m.video_editor_effects_sepia(),
		grayscale: m.video_editor_effects_grayscale(),
		invert: m.video_editor_effects_invert(),
		blur: m.video_editor_effects_blur()
	});

	const gpuCategories = $derived(getGpuCategoriesWithEffects());
	const gpuCategoryLabels = $derived<Record<string, string>>({
		color: m.video_editor_gpu_category_color(),
		blur: m.video_editor_gpu_category_blur(),
		distort: m.video_editor_gpu_category_distort(),
		stylize: m.video_editor_gpu_category_stylize(),
		keying: m.video_editor_gpu_category_keying()
	});

	const blendModeLabels = $derived<Record<BlendMode, string>>({
		normal: m.video_editor_blend_normal(),
		dissolve: m.video_editor_blend_dissolve(),
		darken: m.video_editor_blend_darken(),
		multiply: m.video_editor_blend_multiply(),
		'color-burn': m.video_editor_blend_color_burn(),
		'linear-burn': m.video_editor_blend_linear_burn(),
		lighten: m.video_editor_blend_lighten(),
		screen: m.video_editor_blend_screen(),
		'color-dodge': m.video_editor_blend_color_dodge(),
		'linear-dodge': m.video_editor_blend_linear_dodge(),
		overlay: m.video_editor_blend_overlay(),
		'soft-light': m.video_editor_blend_soft_light(),
		'hard-light': m.video_editor_blend_hard_light(),
		'vivid-light': m.video_editor_blend_vivid_light(),
		'linear-light': m.video_editor_blend_linear_light(),
		'pin-light': m.video_editor_blend_pin_light(),
		'hard-mix': m.video_editor_blend_hard_mix(),
		difference: m.video_editor_blend_difference(),
		exclusion: m.video_editor_blend_exclusion(),
		subtract: m.video_editor_blend_subtract(),
		divide: m.video_editor_blend_divide(),
		hue: m.video_editor_blend_hue(),
		saturation: m.video_editor_blend_saturation(),
		color: m.video_editor_blend_color(),
		luminosity: m.video_editor_blend_luminosity()
	});

	const blendGroupLabels = $derived<Record<string, string>>({
		normal: m.video_editor_blend_group_normal(),
		darken: m.video_editor_blend_group_darken(),
		lighten: m.video_editor_blend_group_lighten(),
		contrast: m.video_editor_blend_group_contrast(),
		inversion: m.video_editor_blend_group_inversion(),
		component: m.video_editor_blend_group_component()
	});
	const effectOptions = $derived([
		...EFFECT_DEFINITIONS.map((definition) => ({
			value: definition.type,
			label: typeLabels[definition.type]
		})),
		...gpuCategories.flatMap((group) =>
			group.effects.map((definition) => ({
				value: `gpu:${definition.id}`,
				label: `${gpuCategoryLabels[group.category]}: ${definition.label}`
			}))
		)
	]);
	const blendOptions = $derived(
		BLEND_MODE_GROUPS.flatMap((group) =>
			group.modes.map((mode) => ({
				value: mode,
				label: `${blendGroupLabels[group.label]}: ${blendModeLabels[mode]}`
			}))
		)
	);

	function definitionFor(type: string) {
		return EFFECT_DEFINITIONS.find((entry) => entry.type === type);
	}

	function handleAdd(): void {
		if (!itemId) return;
		if (pendingKind.startsWith('gpu:')) {
			if (addGpuEffect(itemId, pendingKind.slice(4))) onedit();
			return;
		}
		const definition = definitionFor(pendingKind);
		if (!definition) return;
		if (addEffect(itemId, definition.type)) onedit();
	}

	function commitAmount(effectId: string, amount: number): void {
		if (!itemId) return;
		if (updateEffect(itemId, effectId, { amount })) onedit();
		delete draftAmounts[effectId];
	}

	function commitGpuParam(effect: GpuEffect, paramName: string, value: number): void {
		if (!itemId) return;
		if (setGpuEffectParam(itemId, effect.id, paramName, value)) onedit();
		delete draftAmounts[`${effect.id}:${paramName}`];
	}

	function numericParam(effect: GpuEffect, name: string, fallback: number): number {
		const value = Number(effect.params[name]);
		return Number.isFinite(value) ? value : fallback;
	}

	async function importLut(effect: GpuEffect): Promise<void> {
		if (!itemId) return;
		const handles = await window.showOpenFilePicker?.({
			types: [{ description: '3D LUT', accept: { 'text/plain': ['.cube'] } }],
			multiple: false
		});
		if (!handles?.[0]) return;
		const file = await handles[0].getFile();
		const { encodeCubeLut } = await import('$lib/video-editor/effects/gpu/lut');
		const encoded = encodeCubeLut(await file.text());
		if (
			setGpuEffectData(itemId, effect.id, {
				lutName: file.name,
				lutSize: encoded.size,
				lutData: encoded.data
			})
		)
			onedit();
	}

	function commitBlendMode(value: string): void {
		const mode = ALL_BLEND_MODES.find((entry) => entry === value);
		if (!itemId || !mode) return;
		if (setItemBlendMode(itemId, mode)) onedit();
	}

	function effectLabel(effect: ItemEffect): string {
		if (effect.type !== 'gpu') return typeLabels[effect.type];
		return getGpuEffect(effect.effectId)?.label ?? effect.effectId;
	}
</script>

<div class="flex flex-col gap-1">
	<h3 class="px-1 text-xs font-medium tracking-wide text-[oklch(0.65_0.015_55)] uppercase">
		{m.video_editor_effects()}
	</h3>
	<div class="flex items-center gap-1">
		<AppSelect
			class="h-8 min-w-0 flex-1 text-xs"
			bind:value={pendingKind}
			ariaLabel={m.video_editor_effects_add()}
			options={effectOptions}
		/>
		<button
			type="button"
			class="rounded bg-[oklch(0.22_0.01_50)] px-2 py-1 text-xs hover:bg-[oklch(0.28_0.015_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
			disabled={!itemId}
			onclick={handleAdd}
		>
			{m.video_editor_effects_add()}
		</button>
	</div>
	{#if !itemId || effects.length === 0}
		<p class="px-1 text-xs text-[oklch(0.65_0.015_55)]">{m.video_editor_effects_none()}</p>
	{:else}
		<ul class="flex flex-col gap-1">
			{#each effects as effect (effect.id)}
				{@const definition = definitionFor(effect.type)}
				{@const gpuDefinition = effect.type === 'gpu' ? getGpuEffect(effect.effectId) : undefined}
				<li class="rounded bg-[oklch(0.22_0.01_50)] px-2 py-1.5">
					<div class="flex items-center justify-between gap-1">
						<span class="text-xs">{effectLabel(effect)}</span>
						<button
							type="button"
							class="rounded p-0.5 hover:bg-[oklch(0.28_0.015_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
							aria-label={m.video_editor_effects_remove()}
							onclick={() => {
								if (!itemId) return;
								if (removeEffect(itemId, effect.id)) onedit();
							}}
						>
							<XIcon class="size-3" />
						</button>
					</div>
					{#if definition && effect.type !== 'gpu'}
						<Slider
							class="mt-1"
							min={definition.min}
							max={definition.max}
							step={definition.step}
							value={draftAmounts[effect.id] ?? effect.amount}
							ariaLabel={`${typeLabels[effect.type]} — ${m.video_editor_effects_amount()}`}
							onValueChange={(value) => {
								draftAmounts[effect.id] = value;
							}}
							onValueCommit={(value) => commitAmount(effect.id, value)}
						/>
					{/if}
					{#if gpuDefinition && effect.type === 'gpu'}
						{#if effect.effectId === 'gpu-lut'}
							<button
								type="button"
								class="mt-1 w-full rounded border border-[oklch(0.32_0.015_55)] px-2 py-1 text-xs hover:bg-[oklch(0.28_0.015_50)]"
								onclick={() => importLut(effect)}
								>{typeof effect.params.lutName === 'string'
									? effect.params.lutName
									: 'Choose .cube LUT'}</button
							>
						{/if}
						<div class="mt-1 flex flex-col gap-1">
							{#each gpuDefinition.schema as param (param.name)}
								<label class="flex items-center gap-2 text-xs">
									<span
										class="w-20 shrink-0 truncate text-[oklch(0.65_0.015_55)]"
										title={param.label}
									>
										{param.label}
									</span>
									<Slider
										class="min-w-0 flex-1"
										min={param.min}
										max={param.max}
										step={param.step}
										value={draftAmounts[`${effect.id}:${param.name}`] ??
											numericParam(effect, param.name, param.default)}
										ariaLabel={`${effectLabel(effect)} — ${param.label}`}
										onValueChange={(value) => {
											draftAmounts[`${effect.id}:${param.name}`] = value;
										}}
										onValueCommit={(value) => commitGpuParam(effect, param.name, value)}
									/>
								</label>
							{/each}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	{#if itemId}
		<label class="mt-1 flex items-center gap-2 px-1 text-xs">
			<span class="shrink-0 text-[oklch(0.65_0.015_55)]">{m.video_editor_blend_mode()}</span>
			<AppSelect
				class="h-8 min-w-0 flex-1 text-xs"
				value={item?.blendMode ?? 'normal'}
				options={blendOptions}
				onValueChange={commitBlendMode}
			/>
		</label>
	{/if}
</div>
{#if itemId}<ColorScopes {itemId} />{/if}
