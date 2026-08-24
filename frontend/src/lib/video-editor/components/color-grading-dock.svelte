<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import ColorScopes from './color-scopes.svelte';
	import ColorWorkspace from './color-workspace.svelte';
	import EffectsPanel from './effects-panel.svelte';

	let {
		itemId,
		itemIds = [],
		onedit
	}: { itemId: string | null; itemIds?: string[]; onedit: () => void } = $props();
</script>

<section
	class="grid max-h-[44dvh] min-h-0 shrink-0 grid-cols-1 overflow-y-auto border-t border-[oklch(0.25_0.015_55)] bg-[oklch(0.155_0.009_55)] lg:h-[min(37dvh,340px)] lg:grid-cols-[minmax(240px,0.85fr)_minmax(320px,1.4fr)_minmax(220px,0.75fr)] lg:overflow-hidden"
	aria-label={m.video_editor_color_dock()}
>
	<div
		class="min-h-0 border-b border-[oklch(0.25_0.015_55)] p-2 lg:overflow-y-auto lg:border-r lg:border-b-0"
	>
		<ColorWorkspace {itemId} {itemIds} {onedit} />
	</div>
	<div
		class="min-h-0 border-b border-[oklch(0.25_0.015_55)] p-2 lg:overflow-y-auto lg:border-r lg:border-b-0"
	>
		<EffectsPanel {itemId} {itemIds} {onedit} showColorTools={false} showScopes={false} />
	</div>
	<div class="min-h-0 p-2 lg:overflow-y-auto">
		{#if itemId}
			<ColorScopes {itemId} />
		{:else}
			<p class="p-3 text-center text-xs text-[oklch(0.65_0.015_55)]">
				{m.video_editor_motion_select_clip()}
			</p>
		{/if}
	</div>
</section>
