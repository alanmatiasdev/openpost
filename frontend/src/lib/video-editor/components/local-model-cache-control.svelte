<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import {
		clearLocalModelCache,
		inspectAllLocalModelCaches,
		type LocalModelCacheSummary
	} from '$lib/video-editor/local-ai/model-cache';

	let open = $state(false);
	let loading = $state(false);
	let summaries = $state<LocalModelCacheSummary[]>([]);
	let clearingId = $state<string | null>(null);

	function formatBytes(bytes: number): string {
		if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
	}

	async function refresh(): Promise<void> {
		loading = true;
		try {
			summaries = await inspectAllLocalModelCaches();
		} finally {
			loading = false;
		}
	}

	function toggle(): void {
		open = !open;
		if (open && summaries.length === 0) void refresh();
	}

	async function remove(summary: LocalModelCacheSummary): Promise<void> {
		if (clearingId) return;
		clearingId = summary.id;
		try {
			await clearLocalModelCache(summary);
			await refresh();
		} finally {
			clearingId = null;
		}
	}
</script>

<div class="col-span-2 border-t border-[oklch(0.27_0.012_55)] pt-1">
	<button
		type="button"
		class="flex w-full items-center justify-between rounded px-1 py-0.5 text-[10px] text-[oklch(0.66_0.015_55)] hover:bg-[oklch(0.23_0.012_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
		aria-expanded={open}
		onclick={toggle}
	>
		<span>{m.video_editor_models_manage()}</span>
		<span aria-hidden="true">{open ? '−' : '+'}</span>
	</button>
	{#if open}
		<div class="mt-1 space-y-1" aria-live="polite">
			{#if loading && summaries.length === 0}
				<div class="flex items-center gap-1 px-1 py-2 text-[10px] text-[oklch(0.6_0.012_55)]">
					<LoaderIcon class="size-3 animate-spin" aria-hidden="true" />
					{m.video_editor_local_models_checking()}
				</div>
			{:else}
				{#each summaries as summary (summary.id)}
					<div class="flex items-center gap-1 rounded bg-[oklch(0.2_0.01_55)] px-1.5 py-1">
						<div class="min-w-0 flex-1">
							<div class="truncate text-[10px] text-[oklch(0.82_0.008_70)]">{summary.label}</div>
							<div class="text-[9px] text-[oklch(0.55_0.01_55)]">
								{#if summary.inspectionState !== 'ready'}
									{m.video_editor_models_load_failed()}
								{:else if summary.downloaded}
									{summary.sizeStatus === 'unavailable'
										? m.video_editor_models_cached()
										: formatBytes(summary.totalBytes)}
								{:else}
									{m.video_editor_models_not_cached()}
								{/if}
							</div>
						</div>
						{#if summary.downloaded}
							<Button
								size="xs"
								variant="ghost"
								disabled={clearingId !== null}
								onclick={() => void remove(summary)}
							>
								{clearingId === summary.id
									? m.video_editor_local_models_removing()
									: m.video_editor_models_remove()}
							</Button>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>
