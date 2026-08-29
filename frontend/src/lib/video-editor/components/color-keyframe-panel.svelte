<script lang="ts">
	import DiamondIcon from '@lucide/svelte/icons/diamond';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { m } from '$lib/paraglide/messages';
	import type { KeyframeProperty } from '$lib/video-editor/project/types';
	import {
		effectPropertyBaseValue,
		effectPropertyLabel,
		isEffectKeyframeProperty
	} from '$lib/video-editor/effects/effect-keyframes';
	import { getAnimatablePropertiesForItem } from '$lib/video-editor/timeline/animated-properties';
	import { editorKeyframes, type EditorKeyframe } from '$lib/video-editor/timeline/keyframe-editor';
	import {
		activeValueAt,
		removeKeyframes,
		setKeyframe
	} from '$lib/video-editor/timeline/actions/keyframes';
	import { setCurrentFrame } from '$lib/video-editor/timeline/actions/items';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import KeyframeValueGraph from './keyframe-value-graph.svelte';

	type View = 'sheet' | 'graph';

	let { itemId, onedit }: { itemId: string | null; onedit: () => void } = $props();
	let view = $state<View>('sheet');
	let activeProperty = $state<KeyframeProperty | null>(null);
	let selectedKeyframe = $state<EditorKeyframe | null>(null);

	const item = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);
	const properties = $derived.by(() =>
		item
			? getAnimatablePropertiesForItem(item).filter(isEffectKeyframeProperty)
			: ([] as KeyframeProperty[])
	);

	$effect(() => {
		if (activeProperty && properties.includes(activeProperty)) return;
		activeProperty = properties[0] ?? null;
		selectedKeyframe = null;
	});

	function label(property: KeyframeProperty): string {
		return item ? (effectPropertyLabel(item, property) ?? property) : property;
	}

	function addKeyframe(property: KeyframeProperty): void {
		if (!item) return;
		const relativeFrame = Math.max(
			0,
			Math.min(item.durationInFrames - 1, timelineStore.currentFrame - item.from)
		);
		const value =
			activeValueAt(item, property, timelineStore.currentFrame) ??
			effectPropertyBaseValue(item, property);
		if (value === null || !setKeyframe(item.id, property, relativeFrame, value)) return;
		activeProperty = property;
		onedit();
	}

	function seekKeyframe(property: KeyframeProperty, keyframe: EditorKeyframe): void {
		if (!item) return;
		activeProperty = property;
		selectedKeyframe = keyframe;
		setCurrentFrame(item.from + keyframe.frame);
	}

	function deleteSelected(): void {
		if (!item || !selectedKeyframe) return;
		if (!removeKeyframes(item.id, [selectedKeyframe])) return;
		selectedKeyframe = null;
		onedit();
	}

	function frameLeft(frame: number): number {
		if (!item) return 0;
		return Math.max(0, Math.min(100, (frame / Math.max(1, item.durationInFrames - 1)) * 100));
	}
</script>

<section class="flex h-full min-h-0 flex-col" aria-label={m.video_editor_keyframe_sheet_title()}>
	<header
		class="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3"
	>
		<div class="min-w-0">
			<h3 class="truncate text-xs font-semibold">{m.video_editor_keyframe_sheet_title()}</h3>
			{#if item}
				<p class="truncate text-[9px] text-white/35">{item.label}</p>
			{/if}
		</div>
		<div class="flex shrink-0 items-center gap-1">
			<div class="flex overflow-hidden rounded-sm border border-white/12">
				<button
					type="button"
					class="view-button {view === 'sheet' ? 'view-button-active' : ''}"
					aria-pressed={view === 'sheet'}
					onclick={() => (view = 'sheet')}
				>
					{m.video_editor_keyframe_view_dopesheet()}
				</button>
				<button
					type="button"
					class="view-button border-l border-white/12 {view === 'graph'
						? 'view-button-active'
						: ''}"
					aria-pressed={view === 'graph'}
					onclick={() => (view = 'graph')}
				>
					{m.video_editor_keyframe_view_graph()}
				</button>
			</div>
			<button
				type="button"
				class="icon-button"
				disabled={!selectedKeyframe}
				aria-label={m.common_delete()}
				title={m.common_delete()}
				onclick={deleteSelected}
			>
				<Trash2Icon class="size-3" />
			</button>
		</div>
	</header>

	{#if !item}
		<p class="m-auto px-4 text-center text-xs text-white/40">{m.video_editor_select_clip()}</p>
	{:else if properties.length === 0}
		<div class="m-auto max-w-52 px-4 text-center">
			<DiamondIcon class="mx-auto mb-2 size-5 text-white/25" />
			<p class="text-xs text-white/45">Add a color effect to animate its controls.</p>
		</div>
	{:else if view === 'graph' && activeProperty}
		<div class="flex min-h-0 flex-1 flex-col">
			<label
				class="flex h-8 shrink-0 items-center gap-2 border-b border-white/8 px-2 text-[10px] text-white/50"
			>
				<span class="shrink-0">{m.video_editor_keyframe_property()}</span>
				<select
					class="h-6 min-w-0 flex-1 rounded-sm border border-white/10 bg-black/35 px-1 text-[10px] text-white/80 outline-none focus:border-orange-400"
					value={activeProperty}
					onchange={(event) => {
						activeProperty = event.currentTarget.value as KeyframeProperty;
						selectedKeyframe = null;
					}}
				>
					{#each properties as property (property)}
						<option value={property}>{label(property)}</option>
					{/each}
				</select>
				<button
					type="button"
					class="icon-button"
					aria-label={m.video_editor_keyframe_sheet_add({ property: label(activeProperty) })}
					title={m.video_editor_keyframe_sheet_add({ property: label(activeProperty) })}
					onclick={() => addKeyframe(activeProperty!)}
				>
					<PlusIcon class="size-3" />
				</button>
			</label>
			<div class="min-h-0 flex-1 overflow-hidden">
				<KeyframeValueGraph
					{item}
					property={activeProperty}
					currentFrame={timelineStore.currentFrame}
					onscrub={setCurrentFrame}
					onselect={(keyframe) => (selectedKeyframe = keyframe)}
					{onedit}
				/>
			</div>
		</div>
	{:else}
		<div class="min-h-0 flex-1 overflow-auto" aria-label={m.video_editor_keyframe_sheet_aria()}>
			<div
				class="sticky top-0 z-10 grid h-6 grid-cols-[minmax(7rem,38%)_1fr] border-b border-white/10 bg-[oklch(0.155_0.008_55)] text-[8px] tracking-wider text-white/35 uppercase"
			>
				<span class="flex items-center px-2">{m.video_editor_keyframe_property()}</span>
				<div class="relative border-l border-white/8">
					<span class="absolute top-1 left-1">0</span>
					<span class="absolute top-1 right-1">{item.durationInFrames - 1}</span>
				</div>
			</div>
			{#each properties as property (property)}
				{@const keyframes = editorKeyframes(item, property)}
				<div
					class="grid h-8 grid-cols-[minmax(7rem,38%)_1fr] border-b border-white/[0.06] {activeProperty ===
					property
						? 'bg-orange-400/[0.06]'
						: ''}"
				>
					<div class="flex min-w-0 items-center text-[9px] text-white/65">
						<button
							type="button"
							class="flex min-w-0 flex-1 items-center gap-1.5 self-stretch px-2 text-left hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-orange-400"
							title={label(property)}
							onclick={() => {
								activeProperty = property;
								selectedKeyframe = null;
							}}
						>
							<span class="truncate">{label(property)}</span>
							<span class="ml-auto font-mono text-[8px] text-white/30">{keyframes.length}</span>
						</button>
						<button
							type="button"
							class="flex size-7 shrink-0 items-center justify-center rounded-sm text-white/35 hover:bg-white/10 hover:text-orange-300 focus-visible:outline-2 focus-visible:outline-orange-400"
							aria-label={m.video_editor_keyframe_sheet_add({ property: label(property) })}
							onclick={() => addKeyframe(property)}
						>
							<PlusIcon class="size-3" />
						</button>
					</div>
					<div class="relative border-l border-white/8 bg-black/10">
						{#each keyframes as keyframe (keyframe.id)}
							<button
								type="button"
								class="absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-orange-400"
								style={`left:${frameLeft(keyframe.frame)}%`}
								aria-label={m.video_editor_keyframe_sheet_point({
									property: label(property),
									frame: keyframe.frame
								})}
								onclick={() => seekKeyframe(property, keyframe)}
							>
								<DiamondIcon
									class="size-2.5 {selectedKeyframe?.id === keyframe.id
										? 'fill-orange-300 text-orange-300'
										: 'fill-white/55 text-white/75'}"
								/>
							</button>
						{/each}
						<div
							class="pointer-events-none absolute inset-y-0 w-px bg-orange-300/75"
							style={`left:${frameLeft(timelineStore.currentFrame - item.from)}%`}
						></div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</section>

<style>
	.view-button {
		height: 1.5rem;
		padding-inline: 0.45rem;
		font-size: 0.5625rem;
		color: rgb(255 255 255 / 48%);
	}
	.view-button:hover,
	.icon-button:hover:not(:disabled) {
		background: rgb(255 255 255 / 7%);
		color: rgb(255 255 255 / 86%);
	}
	.view-button-active {
		background: rgb(251 146 60 / 18%);
		color: rgb(253 186 116);
	}
	.icon-button {
		display: flex;
		height: 1.5rem;
		width: 1.5rem;
		align-items: center;
		justify-content: center;
		border-radius: 0.125rem;
		color: rgb(255 255 255 / 48%);
	}
	.icon-button:focus-visible,
	.view-button:focus-visible {
		outline: 2px solid rgb(251 146 60);
		outline-offset: -2px;
	}
	.icon-button:disabled {
		opacity: 0.3;
	}
</style>
