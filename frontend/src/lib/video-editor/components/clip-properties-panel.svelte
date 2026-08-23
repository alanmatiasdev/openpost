<!-- Type-specific, undoable clip inspector with FreeCut-compatible auto-key rules. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
	import { setAnimatedProperty } from '$lib/video-editor/timeline/actions/keyframes';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import type { KeyframeProperty, TimelineItem } from '$lib/video-editor/project/types';

	let { itemId, onedit }: { itemId: string | null; onedit: () => void } = $props();
	const item = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);

	interface NumericField {
		property: KeyframeProperty;
		label: string;
		min: number;
		max: number;
		step: number;
	}

	const transformFields: NumericField[] = [
		{ property: 'x', label: 'X', min: -2, max: 2, step: 0.01 },
		{ property: 'y', label: 'Y', min: -2, max: 2, step: 0.01 },
		{ property: 'width', label: m.video_editor_property_width(), min: 1, max: 7680, step: 1 },
		{ property: 'height', label: m.video_editor_property_height(), min: 1, max: 4320, step: 1 },
		{ property: 'rotation', label: m.video_editor_rotation(), min: -360, max: 360, step: 1 },
		{ property: 'opacity', label: m.video_editor_clip_opacity(), min: 0, max: 1, step: 0.01 },
		{
			property: 'cornerRadius',
			label: m.video_editor_property_radius(),
			min: 0,
			max: 1000,
			step: 1
		}
	];

	const cropFields: NumericField[] = [
		{ property: 'cropLeft', label: m.video_editor_align_left(), min: 0, max: 1, step: 0.01 },
		{ property: 'cropRight', label: m.video_editor_align_right(), min: 0, max: 1, step: 0.01 },
		{ property: 'cropTop', label: m.video_editor_property_top(), min: 0, max: 1, step: 0.01 },
		{ property: 'cropBottom', label: m.video_editor_property_bottom(), min: 0, max: 1, step: 0.01 },
		{
			property: 'cropSoftness',
			label: m.video_editor_property_softness(),
			min: 0,
			max: 1,
			step: 0.01
		}
	];

	const textFields: NumericField[] = [
		{ property: 'fontSize', label: m.video_editor_property_size(), min: 8, max: 500, step: 1 },
		{
			property: 'fontWeight',
			label: m.video_editor_property_weight(),
			min: 100,
			max: 900,
			step: 100
		},
		{
			property: 'lineHeight',
			label: m.video_editor_property_line_height(),
			min: 0.5,
			max: 4,
			step: 0.05
		},
		{
			property: 'letterSpacing',
			label: m.video_editor_property_tracking(),
			min: -10,
			max: 50,
			step: 0.1
		},
		{ property: 'paddingX', label: m.video_editor_property_padding_x(), min: 0, max: 500, step: 1 },
		{ property: 'paddingY', label: m.video_editor_property_padding_y(), min: 0, max: 500, step: 1 },
		{
			property: 'borderRadius',
			label: m.video_editor_property_box_radius(),
			min: 0,
			max: 500,
			step: 1
		},
		{ property: 'strokeWidth', label: m.video_editor_property_stroke(), min: 0, max: 30, step: 0.5 }
	];

	function valueFor(source: TimelineItem, property: KeyframeProperty): number {
		const track = source.keyframes?.[property];
		const relativeFrame = timelineStore.currentFrame - source.from;
		const exact = track?.frames.indexOf(relativeFrame) ?? -1;
		if (track && exact >= 0) return track.values[exact] ?? 0;
		switch (property) {
			case 'x':
				return source.transform?.x ?? defaultValue(property);
			case 'y':
				return source.transform?.y ?? defaultValue(property);
			case 'width':
				return source.transform?.width ?? defaultValue(property);
			case 'height':
				return source.transform?.height ?? defaultValue(property);
			case 'anchorX':
				return source.transform?.anchorX ?? defaultValue(property);
			case 'anchorY':
				return source.transform?.anchorY ?? defaultValue(property);
			case 'rotation':
				return source.transform?.rotation ?? defaultValue(property);
			case 'opacity':
				return source.transform?.opacity ?? defaultValue(property);
			case 'cornerRadius':
				return source.transform?.cornerRadius ?? defaultValue(property);
			case 'cropLeft':
				return source.crop?.left ?? 0;
			case 'cropRight':
				return source.crop?.right ?? 0;
			case 'cropTop':
				return source.crop?.top ?? 0;
			case 'cropBottom':
				return source.crop?.bottom ?? 0;
			case 'cropSoftness':
				return source.crop?.softness ?? 0;
			case 'volume':
				return source.volume ?? 1;
			case 'fontSize':
				return source.fontSize ?? defaultValue(property);
			case 'fontWeight':
				return source.fontWeight ?? defaultValue(property);
			case 'lineHeight':
				return source.lineHeight ?? defaultValue(property);
			case 'letterSpacing':
				return source.letterSpacing ?? 0;
			case 'paddingX':
				return source.paddingX ?? 0;
			case 'paddingY':
				return source.paddingY ?? 0;
			case 'borderRadius':
				return source.borderRadius ?? 0;
			case 'strokeWidth':
				return source.strokeWidth ?? 0;
			case 'textShadowOffsetX':
				return source.textShadow?.offsetX ?? 0;
			case 'textShadowOffsetY':
				return source.textShadow?.offsetY ?? 0;
			case 'textShadowBlur':
				return source.textShadow?.blur ?? 0;
		}
	}

	function defaultValue(property: KeyframeProperty): number {
		if (property === 'opacity' || property === 'volume') return 1;
		if (property === 'fontSize') return 48;
		if (property === 'fontWeight') return 600;
		if (property === 'lineHeight') return 1.2;
		return 0;
	}

	function commitNumeric(property: KeyframeProperty, value: number): void {
		if (!itemId || !Number.isFinite(value)) return;
		if (
			setAnimatedProperty(
				itemId,
				property,
				timelineStore.currentFrame,
				value,
				autoKeyframeStore.isEnabled(itemId, property)
			)
		)
			onedit();
	}

	function commitText(patch: Partial<TimelineItem>): void {
		if (!itemId) return;
		updateItemProperties(itemId, patch, 'UPDATE_CLIP_PROPERTIES');
		onedit();
	}
</script>

{#if item}
	<div class="flex flex-col gap-3" aria-label={m.video_editor_clip_properties()}>
		{#if item.type === 'adjustment'}
			<p class="text-xs leading-relaxed text-[oklch(0.7_0.01_55)]">
				{m.video_editor_adjustment_layer_hint()}
			</p>
		{:else}
			<section>
				<h3
					class="mb-1 text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase"
				>
					{m.video_editor_property_transform()}
				</h3>
				<div class="grid grid-cols-2 gap-1">
					{#each transformFields as field (field.property)}
						<label class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
							<span class="flex items-center justify-between gap-1">
								{field.label}
								<button
									type="button"
									class:active={autoKeyframeStore.isEnabled(item.id, field.property)}
									class="rounded px-1 text-[9px] text-[oklch(0.58_0.01_55)] hover:bg-[oklch(0.28_0.015_50)] [&.active]:bg-[oklch(0.66_0.14_45)] [&.active]:text-black"
									aria-label={m.video_editor_property_auto_key({ property: field.label })}
									onclick={() => autoKeyframeStore.toggle(item.id, field.property)}>A</button
								>
							</span>
							<Input
								class="mt-0.5 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 py-1 text-xs focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
								type="number"
								min={field.min}
								max={field.max}
								step={field.step}
								value={valueFor(item, field.property)}
								onchange={(event) =>
									commitNumeric(field.property, event.currentTarget.valueAsNumber)}
							/>
						</label>
					{/each}
				</div>
			</section>
		{/if}

		{#if item.type === 'video' || item.type === 'image'}
			<section>
				<h3
					class="mb-1 text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase"
				>
					{m.video_editor_crop()}
				</h3>
				<div class="grid grid-cols-2 gap-1">
					{#each cropFields as field (field.property)}
						<label class="text-[10px] text-[oklch(0.7_0.01_55)]"
							>{field.label}<Input
								class="mt-0.5 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 py-1 text-xs"
								type="number"
								min={field.min}
								max={field.max}
								step={field.step}
								value={valueFor(item, field.property)}
								onchange={(event) =>
									commitNumeric(field.property, event.currentTarget.valueAsNumber)}
							/></label
						>
					{/each}
				</div>
			</section>
		{/if}

		{#if item.type === 'video' || item.type === 'audio'}
			<label class="text-[10px] text-[oklch(0.7_0.01_55)]"
				>{m.video_editor_clip_volume()}<Input
					class="mt-0.5 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 py-1 text-xs"
					type="number"
					min="0"
					max="4"
					step="0.01"
					value={valueFor(item, 'volume')}
					onchange={(event) => commitNumeric('volume', event.currentTarget.valueAsNumber)}
				/></label
			>
		{/if}

		{#if item.type === 'text'}
			<section>
				<h3
					class="mb-1 text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase"
				>
					{m.video_editor_tool_text()}
				</h3>
				<Textarea
					class="mb-1 min-h-16 w-full resize-y rounded bg-[oklch(0.22_0.01_50)] p-1.5 text-xs"
					value={item.text ?? ''}
					onblur={(event) =>
						commitText({
							text: event.currentTarget.value,
							label: event.currentTarget.value.slice(0, 48) || item.label
						})}
				></Textarea>
				<div class="grid grid-cols-2 gap-1">
					{#each textFields as field (field.property)}
						<label class="text-[10px] text-[oklch(0.7_0.01_55)]"
							>{field.label}<Input
								class="mt-0.5 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 py-1 text-xs"
								type="number"
								min={field.min}
								max={field.max}
								step={field.step}
								value={valueFor(item, field.property)}
								onchange={(event) =>
									commitNumeric(field.property, event.currentTarget.valueAsNumber)}
							/></label
						>
					{/each}
				</div>
				<div class="mt-1 grid grid-cols-2 gap-1">
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]"
						>{m.video_editor_text_color()}<Input
							class="block h-8 w-full rounded bg-transparent"
							type="color"
							value={item.color ?? '#ffffff'}
							onchange={(event) => commitText({ color: event.currentTarget.value })}
						/></label
					>
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]"
						>{m.video_editor_text_background()}<Input
							class="block h-8 w-full rounded bg-transparent"
							type="color"
							value={item.backgroundColor ?? '#000000'}
							onchange={(event) => commitText({ backgroundColor: event.currentTarget.value })}
						/></label
					>
				</div>
			</section>
		{/if}
	</div>
{/if}
