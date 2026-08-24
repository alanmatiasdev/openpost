<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { m } from '$lib/paraglide/messages';
	import { renderQueueRunner } from '../export/render-queue-runner';
	import { renderQueueStore, type RenderQueueJob } from '../export/render-queue-store';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import ListVideoIcon from '@lucide/svelte/icons/list-video';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RotateIcon from '@lucide/svelte/icons/rotate-ccw';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';

	let open = $state(false);
	const activeCount = $derived(
		$renderQueueStore.jobs.filter((job) => job.status === 'queued' || job.status === 'rendering')
			.length
	);

	function statusLabel(job: RenderQueueJob): string {
		switch (job.status) {
			case 'queued':
				return m.video_editor_queue_status_queued();
			case 'rendering':
				return m.video_editor_queue_status_rendering();
			case 'completed':
				return m.video_editor_queue_status_completed();
			case 'failed':
				return m.video_editor_queue_status_failed();
			case 'cancelled':
				return m.video_editor_queue_status_cancelled();
		}
	}

	function formatDetails(job: RenderQueueJob): string {
		const duration =
			(job.settings.range.endFrame - job.settings.range.startFrame) / job.snapshot.fps;
		const format = job.settings.format.toUpperCase();
		const output = ['mp3', 'aac', 'wav'].includes(job.settings.format)
			? format
			: `${format} · ${job.settings.width}×${job.settings.height}`;
		return `${output} · ${duration.toFixed(1)}s`;
	}
</script>

<Dialog.Root bind:open>
	<Button size="sm" variant="ghost" class="mt-1 w-full" onclick={() => (open = true)}>
		<ListVideoIcon class="size-3.5" aria-hidden="true" />
		{m.video_editor_queue_title()}{activeCount > 0 ? ` (${activeCount})` : ''}
	</Button>
	<Dialog.Content
		class="video-editor-theme flex max-h-[calc(100dvh-2rem)] flex-col gap-0 border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] text-[var(--video-editor-text)] sm:max-w-lg"
	>
		<Dialog.Header class="pr-8">
			<Dialog.Title class="text-base text-[var(--video-editor-text)]">
				{m.video_editor_queue_title()}
			</Dialog.Title>
			<Dialog.Description class="text-[var(--video-editor-muted)]">
				{m.video_editor_queue_description()}
			</Dialog.Description>
		</Dialog.Header>
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<Button
				size="sm"
				variant="outline"
				disabled={activeCount === 0}
				onclick={() => renderQueueStore.setPaused(!$renderQueueStore.isPaused)}
			>
				{#if $renderQueueStore.isPaused}<PlayIcon />{m.video_editor_queue_resume()}{:else}<PauseIcon
					/>{m.video_editor_queue_pause()}{/if}
			</Button>
			<Button
				size="sm"
				variant="ghost"
				disabled={!$renderQueueStore.jobs.some(
					(job) =>
						job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'
				)}
				onclick={() => renderQueueStore.clearFinished()}
				>{m.video_editor_queue_clear_finished()}</Button
			>
			<Button
				size="sm"
				variant="destructive"
				disabled={$renderQueueStore.jobs.length === 0}
				onclick={() => renderQueueRunner.clearAll()}>{m.video_editor_queue_clear_all()}</Button
			>
		</div>
		{#if $renderQueueStore.isPaused && activeCount > 0}<p class="mt-2 text-xs text-amber-200">
				{m.video_editor_queue_paused()}
			</p>{/if}
		<div class="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
			{#if $renderQueueStore.jobs.length === 0}<p
					class="py-10 text-center text-sm text-[var(--video-editor-muted)]"
				>
					{m.video_editor_queue_empty()}
				</p>{:else}
				<ul class="space-y-2">
					{#each $renderQueueStore.jobs as job (job.id)}<li
							class="rounded-lg border border-[var(--video-editor-border)] bg-[var(--video-editor-control)] p-3"
						>
							<div class="flex items-start gap-2">
								<div class="min-w-0 flex-1">
									<p class="text-sm leading-tight font-medium break-words">{job.name}</p>
									<p class="text-[11px] text-[var(--video-editor-muted)]">
										{formatDetails(job)} · {statusLabel(job)}
									</p>
									{#if job.status === 'rendering'}<div
											class="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--video-editor-canvas)]"
										>
											<div
												class="h-full bg-[var(--video-editor-focus)]"
												style={`width: ${Math.round(job.progress * 100)}%`}
											></div>
										</div>
										<p class="mt-1 text-[10px] text-[var(--video-editor-muted)] tabular-nums">
											{job.framesDone ?? 0}/{job.totalFrames ?? 0} · {Math.round(
												job.progress * 100
											)}%
										</p>{/if}
									{#if job.error}<p class="mt-1 text-xs text-red-200">{job.error}</p>{/if}
									{#if job.savedPath}<p class="mt-1 truncate text-xs text-emerald-200">
											{job.savedPath}
										</p>{/if}
								</div>
								<div class="flex shrink-0 gap-0.5">
									{#if job.status === 'queued'}<Button
											variant="ghost"
											size="icon-xs"
											aria-label={m.video_editor_queue_move_up()}
											onclick={() => renderQueueStore.move(job.id, -1)}><ChevronUpIcon /></Button
										><Button
											variant="ghost"
											size="icon-xs"
											aria-label={m.video_editor_queue_move_down()}
											onclick={() => renderQueueStore.move(job.id, 1)}><ChevronDownIcon /></Button
										>{/if}
									{#if job.status === 'failed' || job.status === 'cancelled'}<Button
											variant="ghost"
											size="icon-xs"
											aria-label={m.video_editor_queue_retry()}
											onclick={() => renderQueueStore.retry(job.id)}><RotateIcon /></Button
										>{/if}
									{#if job.status === 'queued' || job.status === 'rendering'}<Button
											variant="ghost"
											size="icon-xs"
											aria-label={m.video_editor_queue_cancel()}
											onclick={() => renderQueueRunner.cancel(job.id)}><XIcon /></Button
										>{:else}<Button
											variant="ghost"
											size="icon-xs"
											aria-label={m.video_editor_queue_remove()}
											onclick={() => renderQueueStore.remove(job.id)}><TrashIcon /></Button
										>{/if}
								</div>
							</div>
						</li>{/each}
				</ul>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
