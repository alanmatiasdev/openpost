<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import * as Tabs from '$lib/components/ui/tabs';
	import LottieBrowserPanel from './lottie-browser-panel.svelte';
	import VectorAssetPanel from './shape-panel.svelte';
	import StickerBrowserPanel from './sticker-browser-panel.svelte';
	import StockBrowserPanel from './stock-browser-panel.svelte';
	import BackgroundPanel from './background-panel.svelte';

	type AssetTab = 'shapes' | 'backgrounds' | 'stock' | 'stickers' | 'lottie';
	let { projectId, oninserted }: { projectId: string; oninserted: (itemId: string) => void } =
		$props();
	let activeTab = $state<AssetTab>('shapes');
</script>

<Tabs.Root bind:value={activeTab} class="flex min-h-0 flex-1 flex-col">
	<div class="border-b border-[oklch(0.25_0.015_55)] p-2 pb-1.5">
		<Tabs.List class="grid w-full grid-cols-5 bg-[oklch(0.18_0.01_55)]">
			<Tabs.Trigger value="shapes">{m.video_editor_shapes()}</Tabs.Trigger>
			<Tabs.Trigger value="backgrounds">{m.video_editor_backgrounds_title()}</Tabs.Trigger>
			<Tabs.Trigger value="stock">{m.video_editor_stock_assets()}</Tabs.Trigger>
			<Tabs.Trigger value="stickers">{m.video_editor_stickers()}</Tabs.Trigger>
			<Tabs.Trigger value="lottie">{m.video_editor_animations()}</Tabs.Trigger>
		</Tabs.List>
	</div>
	{#if activeTab === 'shapes'}
		<VectorAssetPanel {oninserted} />
	{:else if activeTab === 'backgrounds'}
		<BackgroundPanel {oninserted} />
	{:else if activeTab === 'stock'}
		<StockBrowserPanel {projectId} {oninserted} />
	{:else if activeTab === 'stickers'}
		<StickerBrowserPanel {projectId} {oninserted} />
	{:else}
		<LottieBrowserPanel {projectId} />
	{/if}
</Tabs.Root>
