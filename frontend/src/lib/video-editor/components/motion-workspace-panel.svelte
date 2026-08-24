<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import type { AnimationPreset } from '$lib/video-editor/project/types';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import ClipPropertiesPanel from './clip-properties-panel.svelte';
	import MotionPresetsPanel from './motion-presets-panel.svelte';
	import TextMotionPanel from './text-motion-panel.svelte';

	let {
		itemId,
		itemIds = [],
		frameWidth,
		frameHeight,
		fps,
		animationPresets = [],
		onsavepreset = () => {},
		ondeletepreset = () => {},
		onedit
	}: {
		itemId: string | null;
		itemIds?: string[];
		frameWidth: number;
		frameHeight: number;
		fps: number;
		animationPresets?: AnimationPreset[];
		onsavepreset?: (preset: AnimationPreset) => void;
		ondeletepreset?: (presetId: string) => void;
		onedit: () => void;
	} = $props();

	const item = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);
	const supportsMotion = $derived(
		item !== undefined &&
			['video', 'image', 'lottie', 'text', 'subtitle', 'shape', 'composition'].includes(item.type)
	);
</script>

<aside
	class="flex max-h-[44dvh] w-full shrink-0 flex-col gap-2 overflow-y-auto border-t border-[oklch(0.25_0.015_55)] p-2 lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l"
	aria-label={m.video_editor_workspace_motion()}
>
	<h2 class="px-1 text-xs font-medium tracking-wide text-[oklch(0.65_0.015_55)] uppercase">
		{m.video_editor_workspace_motion()}
	</h2>
	{#if supportsMotion}
		<ClipPropertiesPanel {itemId} {onedit} />
		<MotionPresetsPanel
			{itemId}
			{itemIds}
			{frameWidth}
			{frameHeight}
			{fps}
			{animationPresets}
			{onsavepreset}
			{ondeletepreset}
			{onedit}
		/>
		{#if item?.type === 'text'}
			<TextMotionPanel {itemId} {itemIds} {onedit} />
		{/if}
	{:else}
		<p class="p-3 text-center text-xs text-[oklch(0.65_0.015_55)]">
			{m.video_editor_motion_select_clip()}
		</p>
	{/if}
</aside>
