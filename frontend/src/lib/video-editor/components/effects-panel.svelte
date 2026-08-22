<!--
	Effects panel: per-clip color/blur effect stack (CSS-filter semantics).
	Sliders draft locally and commit one undoable updateEffect on release.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Slider } from '$lib/components/ui/slider';
	import XIcon from '@lucide/svelte/icons/x';
	import { EFFECT_DEFINITIONS, type ItemType } from '$lib/video-editor/effects/types';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		addEffect,
		removeEffect,
		updateEffect
	} from '$lib/video-editor/timeline/actions/effects';

	let { itemId, onedit }: { itemId: string | null; onedit: () => void } = $props();

	const item = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);
	const effects = $derived(item?.effects ?? []);

	/** In-flight slider values so dragging stays smooth before the undoable commit. */
	let draftAmounts = $state<Record<string, number>>({});
	let pendingType = $state<ItemType>('brightness');

	const typeLabels = $derived<Record<ItemType, string>>({
		brightness: m.video_editor_effects_brightness(),
		contrast: m.video_editor_effects_contrast(),
		saturation: m.video_editor_effects_saturation(),
		'hue-rotate': m.video_editor_effects_hue_rotate(),
		sepia: m.video_editor_effects_sepia(),
		grayscale: m.video_editor_effects_grayscale(),
		invert: m.video_editor_effects_invert(),
		blur: m.video_editor_effects_blur()
	});

	function definitionFor(type: ItemType) {
		return EFFECT_DEFINITIONS.find((entry) => entry.type === type);
	}

	function handleAdd(): void {
		if (!itemId || !definitionFor(pendingType)) return;
		if (addEffect(itemId, pendingType)) onedit();
	}

	function commitAmount(effectId: string, amount: number): void {
		if (!itemId) return;
		if (updateEffect(itemId, effectId, { amount })) onedit();
		delete draftAmounts[effectId];
	}
</script>

<div class="flex flex-col gap-1">
	<h3 class="px-1 text-xs font-medium tracking-wide text-[oklch(0.65_0.015_55)] uppercase">
		{m.video_editor_effects()}
	</h3>
	<div class="flex items-center gap-1">
		<select
			class="min-w-0 flex-1 rounded bg-[oklch(0.22_0.01_50)] px-1 py-1 text-xs focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
			bind:value={pendingType}
			aria-label={m.video_editor_effects_add()}
		>
			{#each EFFECT_DEFINITIONS as definition (definition.type)}
				<option value={definition.type}>{typeLabels[definition.type]}</option>
			{/each}
		</select>
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
				<li class="rounded bg-[oklch(0.22_0.01_50)] px-2 py-1.5">
					<div class="flex items-center justify-between gap-1">
						<span class="text-xs">{typeLabels[effect.type]}</span>
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
					{#if definition}
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
				</li>
			{/each}
		</ul>
	{/if}
</div>
