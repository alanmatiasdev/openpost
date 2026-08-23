<!-- Type-specific, undoable clip inspector with FreeCut-compatible auto-key rules. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import AppSelect, { type AppSelectOption } from '$lib/components/app-select.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
	import { setAnimatedProperty } from '$lib/video-editor/timeline/actions/keyframes';
	import { setItemsReversed, updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import {
		cancelReverseConform,
		conformReversePreview,
		reverseConformStatus,
		subscribeReverseConform,
		type ReverseConformStatus
	} from '$lib/video-editor/media/reverse-conform-service';
	import type { KeyframeProperty, TimelineItem } from '$lib/video-editor/project/types';
	import ShapePropertiesPanel from './shape-properties-panel.svelte';
	import CornerPinPropertiesPanel from './corner-pin-properties-panel.svelte';
	import LottiePropertiesPanel from './lottie-properties-panel.svelte';
	import TextPropertiesPanel from './text-properties-panel.svelte';
	import SubtitlePropertiesPanel from './subtitle-properties-panel.svelte';
	import { editorSession } from '$lib/video-editor/editor.svelte';

	let { itemId, onedit }: { itemId: string | null; onedit: () => void } = $props();
	const item = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);
	let conformStatus = $state<ReverseConformStatus>({
		state: 'idle',
		progress: 0
	});

	$effect(() => {
		const mediaId = item?.mediaId;
		if (!mediaId) {
			conformStatus = { state: 'idle', progress: 0 };
			return;
		}
		conformStatus = reverseConformStatus(mediaId);
		return subscribeReverseConform(mediaId, (status) => (conformStatus = status));
	});

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
		{
			property: 'width',
			label: m.video_editor_property_width(),
			min: 1,
			max: 7680,
			step: 1
		},
		{
			property: 'height',
			label: m.video_editor_property_height(),
			min: 1,
			max: 4320,
			step: 1
		},
		{
			property: 'rotation',
			label: m.video_editor_rotation(),
			min: -360,
			max: 360,
			step: 1
		},
		{
			property: 'opacity',
			label: m.video_editor_clip_opacity(),
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			property: 'cornerRadius',
			label: m.video_editor_property_radius(),
			min: 0,
			max: 1000,
			step: 1
		}
	];

	const cropFields: NumericField[] = [
		{
			property: 'cropLeft',
			label: m.video_editor_align_left(),
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			property: 'cropRight',
			label: m.video_editor_align_right(),
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			property: 'cropTop',
			label: m.video_editor_property_top(),
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			property: 'cropBottom',
			label: m.video_editor_property_bottom(),
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			property: 'cropSoftness',
			label: m.video_editor_property_softness(),
			min: 0,
			max: 1,
			step: 0.01
		}
	];

	const textFields: NumericField[] = [
		{
			property: 'fontSize',
			label: m.video_editor_property_size(),
			min: 8,
			max: 500,
			step: 1
		},
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
		{
			property: 'paddingX',
			label: m.video_editor_property_padding_x(),
			min: 0,
			max: 500,
			step: 1
		},
		{
			property: 'paddingY',
			label: m.video_editor_property_padding_y(),
			min: 0,
			max: 500,
			step: 1
		},
		{
			property: 'borderRadius',
			label: m.video_editor_property_box_radius(),
			min: 0,
			max: 500,
			step: 1
		},
		{
			property: 'strokeWidth',
			label: m.video_editor_property_stroke(),
			min: 0,
			max: 30,
			step: 0.5
		},
		{
			property: 'textShadowOffsetX',
			label: m.video_editor_text_shadow_x(),
			min: -100,
			max: 100,
			step: 1
		},
		{
			property: 'textShadowOffsetY',
			label: m.video_editor_text_shadow_y(),
			min: -100,
			max: 100,
			step: 1
		},
		{
			property: 'textShadowBlur',
			label: m.video_editor_text_shadow_blur(),
			min: 0,
			max: 160,
			step: 1
		}
	];
	const textAlignmentOptions: AppSelectOption[] = [
		{ value: 'left', label: m.video_editor_align_left() },
		{ value: 'center', label: m.video_editor_align_center() },
		{ value: 'right', label: m.video_editor_align_right() }
	];
	const verticalAlignmentOptions: AppSelectOption[] = [
		{ value: 'top', label: m.video_editor_property_top() },
		{ value: 'middle', label: m.video_editor_align_center() },
		{ value: 'bottom', label: m.video_editor_property_bottom() }
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
		return defaultValue(property);
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

	function commitTextShadowColor(color: string): void {
		const current = itemId ? timelineStore.itemById.get(itemId) : undefined;
		commitText({
			textShadow: {
				blur: current?.textShadow?.blur ?? 0,
				color,
				offsetX: current?.textShadow?.offsetX ?? 0,
				offsetY: current?.textShadow?.offsetY ?? 0
			}
		});
	}

	function toggleReverse(): void {
		if (!item) return;
		const willReverse = item.isReversed !== true;
		if (setItemsReversed([item.id], willReverse).length === 0) return;
		onedit();
		if (!willReverse || !item.mediaId) return;
		const media = mediaPool.get(item.mediaId);
		if (media?.tags.includes('video')) void conformReversePreview(media).catch(() => undefined);
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
									aria-label={m.video_editor_property_auto_key({
										property: field.label
									})}
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

		{#if item.type === 'video' || item.type === 'image' || item.type === 'lottie'}
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

		{#if item.type === 'shape'}
			<ShapePropertiesPanel {item} {onedit} />
		{/if}

		{#if item.type === 'lottie'}
			<LottiePropertiesPanel {item} {onedit} />
		{/if}

		{#if ['video', 'image', 'lottie', 'text', 'shape', 'subtitle', 'composition'].includes(item.type)}
			<CornerPinPropertiesPanel {item} {onedit} />
		{/if}

		{#if item.type === 'video' || item.type === 'audio'}
			<section class="space-y-2">
				<h3 class="text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase">
					{m.video_editor_clip_playback()}
				</h3>
				<Button
					type="button"
					size="sm"
					variant={item.isReversed ? 'secondary' : 'outline'}
					class="h-8 w-full justify-between text-xs"
					aria-label={m.video_editor_clip_reverse()}
					aria-pressed={item.isReversed === true}
					onclick={toggleReverse}
				>
					<span>{m.video_editor_clip_reverse()}</span>
					<span class="text-[10px] opacity-70">
						{item.isReversed ? m.video_editor_clip_reverse_on() : m.video_editor_clip_reverse_off()}
					</span>
				</Button>
				<p class="text-[10px] leading-relaxed text-[oklch(0.62_0.01_55)]">
					{m.video_editor_clip_reverse_hint()}
				</p>
				{#if item.isReversed && (conformStatus.state === 'preparing' || conformStatus.state === 'rendering')}
					<div class="rounded border border-white/10 bg-black/20 p-2">
						<div class="flex items-center justify-between gap-2 text-[10px] text-white/75">
							<span>{m.video_editor_clip_reverse_preparing()}</span>
							<span>{Math.round(conformStatus.progress * 100)}%</span>
						</div>
						<div class="mt-1 h-1 overflow-hidden rounded bg-white/10">
							<div
								class="h-full bg-[oklch(0.66_0.14_45)] transition-[width] motion-reduce:transition-none"
								style:width={`${Math.round(conformStatus.progress * 100)}%`}
							></div>
						</div>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							class="mt-1 h-6 px-1.5 text-[10px]"
							onclick={() => item.mediaId && cancelReverseConform(item.mediaId)}
						>
							{m.common_cancel()}
						</Button>
					</div>
				{:else if item.isReversed && conformStatus.state === 'ready'}
					<p class="text-[10px] text-[oklch(0.74_0.1_145)]">
						{m.video_editor_clip_reverse_ready()}
					</p>
				{:else if item.isReversed && (conformStatus.state === 'error' || conformStatus.state === 'canceled')}
					<p class="text-[10px] text-[oklch(0.72_0.14_30)]">
						{m.video_editor_clip_reverse_fallback()}
					</p>
				{/if}
				<label class="block text-[10px] text-[oklch(0.7_0.01_55)]"
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
			</section>
		{/if}

		{#if item.type === 'text'}
			<section>
				<h3
					class="mb-1 text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase"
				>
					{m.video_editor_tool_text()}
				</h3>
				<TextPropertiesPanel {item} {onedit} />
				<div class="mt-2 grid grid-cols-2 gap-1">
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
						/><button
							type="button"
							class="mt-0.5 w-full rounded px-1 py-1 text-[9px] text-[oklch(0.62_0.01_55)] hover:bg-[oklch(0.28_0.015_50)] hover:text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:opacity-40"
							disabled={!item.backgroundColor}
							onclick={() => commitText({ backgroundColor: undefined })}
							>{m.video_editor_text_clear_background()}</button
						></label
					>
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]"
						>{m.video_editor_text_stroke_color()}<Input
							class="block h-8 w-full rounded bg-transparent"
							type="color"
							value={item.strokeColor ?? '#000000'}
							onchange={(event) => commitText({ strokeColor: event.currentTarget.value })}
						/></label
					>
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]"
						>{m.video_editor_text_shadow_color()}<Input
							class="block h-8 w-full rounded bg-transparent"
							type="color"
							value={item.textShadow?.color ?? '#000000'}
							onchange={(event) => commitTextShadowColor(event.currentTarget.value)}
						/></label
					>
				</div>
				<div class="mt-1 grid grid-cols-2 gap-1">
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
						{m.video_editor_text_alignment()}
						<AppSelect
							value={item.textAlign ?? 'center'}
							options={textAlignmentOptions}
							ariaLabel={m.video_editor_text_alignment()}
							class="mt-0.5 h-8 w-full text-xs"
							onValueChange={(textAlign) =>
								commitText({
									textAlign: textAlign as TimelineItem['textAlign']
								})}
						/>
					</label>
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
						{m.video_editor_text_vertical_alignment()}
						<AppSelect
							value={item.verticalAlign ?? 'middle'}
							options={verticalAlignmentOptions}
							ariaLabel={m.video_editor_text_vertical_alignment()}
							class="mt-0.5 h-8 w-full text-xs"
							onValueChange={(verticalAlign) =>
								commitText({
									verticalAlign: verticalAlign as TimelineItem['verticalAlign']
								})}
						/>
					</label>
				</div>
			</section>
		{/if}

		{#if item.type === 'subtitle'}
			<SubtitlePropertiesPanel
				{item}
				canvasWidth={editorSession.project?.metadata.width ?? 1920}
				canvasHeight={editorSession.project?.metadata.height ?? 1080}
				{onedit}
			/>
		{/if}
	</div>
{/if}
