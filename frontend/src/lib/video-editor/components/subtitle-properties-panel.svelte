<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import AppSelect, { type AppSelectOption } from '$lib/components/app-select.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { TimelineItem } from '../project/types';
	import { updateItemProperties } from '../timeline/actions/items';
	import { timelineStore } from '../timeline/stores/timeline-store.svelte';
	import {
		CAPTION_STYLE_PRESETS,
		detectActiveCaptionPreset,
		resolveCaptionStylePatch,
		type CaptionStylePresetId
	} from '../typography/caption-style-presets';

	let {
		item,
		canvasWidth,
		canvasHeight,
		onedit
	}: {
		item: TimelineItem;
		canvasWidth: number;
		canvasHeight: number;
		onedit: () => void;
	} = $props();

	const activeItem = $derived(timelineStore.itemById.get(item.id) ?? item);
	const activePreset = $derived(
		detectActiveCaptionPreset(activeItem, canvasWidth, canvasHeight)?.id ?? null
	);

	const fontOptions: AppSelectOption[] = [
		'Inter',
		'Roboto',
		'Roboto Slab',
		'Manrope',
		'Anton',
		'Bebas Neue',
		'Inter Tight',
		'Orbitron'
	].map((font) => ({ value: font, label: font }));
	const alignmentOptions = $derived<AppSelectOption[]>([
		{ value: 'left', label: m.video_editor_align_left() },
		{ value: 'center', label: m.video_editor_align_center() },
		{ value: 'right', label: m.video_editor_align_right() }
	]);

	function presetLabel(id: CaptionStylePresetId): string {
		switch (id) {
			case 'netflix':
				return m.video_editor_caption_preset_netflix();
			case 'youtube':
				return m.video_editor_caption_preset_youtube();
			case 'bold-yellow':
				return m.video_editor_caption_preset_bold_yellow();
			case 'minimal-stroke':
				return m.video_editor_caption_preset_outlined();
			case 'tiktok':
				return m.video_editor_caption_preset_tiktok();
		}
	}

	function commit(patch: Partial<TimelineItem>, command = 'UPDATE_CAPTION_STYLE'): void {
		updateItemProperties(activeItem.id, patch, command);
		onedit();
	}

	function applyPreset(id: CaptionStylePresetId): void {
		const preset = CAPTION_STYLE_PRESETS.find((candidate) => candidate.id === id);
		if (!preset) return;
		commit(
			resolveCaptionStylePatch(preset, canvasWidth, canvasHeight, activeItem.transform),
			'APPLY_CAPTION_STYLE_PRESET'
		);
	}
</script>

<section class="space-y-2" aria-labelledby={`caption-style-${activeItem.id}`}>
	<h3
		id={`caption-style-${activeItem.id}`}
		class="text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase"
	>
		{m.video_editor_caption_style()}
	</h3>

	<div class="space-y-1">
		<span id={`caption-presets-${activeItem.id}`} class="field-label">
			{m.video_editor_caption_presets()}
		</span>
		<div class="preset-strip" aria-labelledby={`caption-presets-${activeItem.id}`}>
			{#each CAPTION_STYLE_PRESETS as preset (preset.id)}
				<button
					type="button"
					class:active={activePreset === preset.id}
					aria-pressed={activePreset === preset.id}
					onclick={() => applyPreset(preset.id)}
				>
					<span class="preset-preview" data-preset={preset.id} aria-hidden="true">
						<span>Caption</span>
					</span>
					<span class="preset-name">{presetLabel(preset.id)}</span>
				</button>
			{/each}
		</div>
	</div>

	<div class="grid grid-cols-2 gap-1.5">
		<label class="field-label col-span-2">
			{m.video_editor_text_font()}
			<AppSelect
				value={activeItem.fontFamily ?? 'Inter'}
				options={fontOptions}
				ariaLabel={m.video_editor_text_font()}
				class="mt-0.5 h-8 w-full text-xs"
				onValueChange={(fontFamily) => commit({ fontFamily })}
			/>
		</label>
		<label class="field-label">
			{m.video_editor_property_size()}
			<Input
				class="field-input"
				type="number"
				min="8"
				max="500"
				step="1"
				value={activeItem.fontSize ?? 60}
				onchange={(event) => commit({ fontSize: event.currentTarget.valueAsNumber })}
			/>
		</label>
		<label class="field-label">
			{m.video_editor_text_alignment()}
			<AppSelect
				value={activeItem.textAlign ?? 'center'}
				options={alignmentOptions}
				ariaLabel={m.video_editor_text_alignment()}
				class="mt-0.5 h-8 w-full text-xs"
				onValueChange={(textAlign) => commit({ textAlign: textAlign as TimelineItem['textAlign'] })}
			/>
		</label>
		<label class="field-label">
			{m.video_editor_text_color()}
			<Input
				class="mt-0.5 h-8 w-full bg-transparent"
				type="color"
				value={activeItem.color ?? '#ffffff'}
				onchange={(event) => commit({ color: event.currentTarget.value })}
			/>
		</label>
		<label class="field-label">
			{m.video_editor_text_stroke_color()}
			<Input
				class="mt-0.5 h-8 w-full bg-transparent"
				type="color"
				value={activeItem.strokeColor ?? '#000000'}
				onchange={(event) => commit({ strokeColor: event.currentTarget.value })}
			/>
		</label>
		<label class="field-label">
			{m.video_editor_property_stroke()}
			<Input
				class="field-input"
				type="number"
				min="0"
				max="30"
				step="0.5"
				value={activeItem.strokeWidth ?? 0}
				onchange={(event) => commit({ strokeWidth: event.currentTarget.valueAsNumber })}
			/>
		</label>
		<label class="field-label">
			{m.video_editor_property_line_height()}
			<Input
				class="field-input"
				type="number"
				min="0.5"
				max="4"
				step="0.05"
				value={activeItem.lineHeight ?? 1.25}
				onchange={(event) => commit({ lineHeight: event.currentTarget.valueAsNumber })}
			/>
		</label>
	</div>

	<div class="grid grid-cols-3 gap-1" role="group" aria-label={m.video_editor_caption_style()}>
		<Button
			type="button"
			size="sm"
			variant={(activeItem.fontWeight ?? 600) >= 700 ? 'secondary' : 'ghost'}
			aria-pressed={(activeItem.fontWeight ?? 600) >= 700}
			onclick={() =>
				commit({
					fontWeight: (activeItem.fontWeight ?? 600) >= 700 ? 600 : 700
				})}
		>
			{m.video_editor_caption_bold()}
		</Button>
		<Button
			type="button"
			size="sm"
			variant={activeItem.fontStyle === 'italic' ? 'secondary' : 'ghost'}
			aria-pressed={activeItem.fontStyle === 'italic'}
			onclick={() =>
				commit({
					fontStyle: activeItem.fontStyle === 'italic' ? 'normal' : 'italic'
				})}
		>
			{m.video_editor_text_italic()}
		</Button>
		<Button
			type="button"
			size="sm"
			variant={activeItem.underline ? 'secondary' : 'ghost'}
			aria-pressed={activeItem.underline ?? false}
			onclick={() => commit({ underline: !activeItem.underline })}
		>
			{m.video_editor_text_underline()}
		</Button>
	</div>
</section>

<style>
	.field-label {
		display: block;
		font-size: 0.625rem;
		line-height: 1rem;
		color: oklch(0.7 0.01 55);
	}
	:global(.field-input) {
		width: 100%;
		height: 2rem;
		margin-top: 0.125rem;
		border-color: oklch(0.3 0.012 55);
		background: oklch(0.22 0.01 50);
		padding-inline: 0.375rem;
		font-size: 0.75rem;
		color: white;
	}
	.preset-strip {
		display: flex;
		gap: 0.375rem;
		overflow-x: auto;
		padding: 0.125rem 0.125rem 0.375rem;
		scrollbar-color: oklch(0.35 0.015 55) transparent;
		scrollbar-width: thin;
	}
	.preset-strip > button {
		width: 5.25rem;
		flex: 0 0 5.25rem;
		border: 1px solid oklch(0.29 0.012 55);
		border-radius: 0.5rem;
		padding: 0.25rem;
		color: oklch(0.72 0.01 55);
		text-align: left;
	}
	.preset-strip > button:hover,
	.preset-strip > button:focus-visible {
		border-color: oklch(0.48 0.08 45);
		color: white;
	}
	.preset-strip > button:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 1px;
	}
	.preset-strip > button.active {
		border-color: oklch(0.66 0.14 45);
		box-shadow: inset 0 0 0 1px oklch(0.66 0.14 45);
	}
	.preset-preview {
		display: grid;
		height: 2.75rem;
		place-items: center;
		overflow: hidden;
		border-radius: 0.25rem;
		background: #050505;
		padding: 0.25rem;
		color: white;
		font-size: 0.48rem;
		line-height: 1.1;
		text-align: center;
	}
	.preset-preview[data-preset='netflix'] span {
		border-radius: 0.15rem;
		background: rgb(0 0 0 / 55%);
		padding: 0.18rem 0.25rem;
		font-family: 'Inter Variable', sans-serif;
		font-weight: 600;
	}
	.preset-preview[data-preset='youtube'] span {
		font-family: 'Roboto', sans-serif;
		font-weight: 500;
		text-shadow: 0 2px 5px black;
	}
	.preset-preview[data-preset='bold-yellow'] span {
		color: #ffd400;
		font-family: 'Roboto Slab', serif;
		font-weight: 700;
		-webkit-text-stroke: 0.35px black;
	}
	.preset-preview[data-preset='minimal-stroke'] span {
		font-family: 'Manrope Variable', sans-serif;
		-webkit-text-stroke: 0.35px black;
	}
	.preset-preview[data-preset='tiktok'] span {
		font-family: 'Anton', sans-serif;
		font-size: 0.7rem;
		letter-spacing: 0.04em;
		text-shadow: 0 2px 3px black;
		-webkit-text-stroke: 0.45px black;
	}
	.preset-name {
		display: block;
		overflow: hidden;
		padding: 0.25rem 0.125rem 0;
		font-size: 0.5625rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (pointer: coarse) {
		.preset-strip > button {
			min-height: 2.75rem;
		}
	}
</style>
