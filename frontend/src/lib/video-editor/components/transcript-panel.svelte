<!--
	Transcript panel: cue rows for every subtitle item. Clicking a row seeks
	to the cue start; text edits commit on blur as one undoable step.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { setCurrentFrame } from '$lib/video-editor/timeline/actions/items';
	import { execute } from '$lib/video-editor/timeline/commands/command-store.svelte';
	import type { SubtitleCue, TimelineItem } from '$lib/video-editor/project/types';

	let { onedit }: { onedit: () => void } = $props();

	const subtitleItems = $derived(timelineStore.items.filter((item) => item.type === 'subtitle'));

	/** In-flight inline edits keyed by cue id; committed to the store on blur. */
	let draftTexts = $state<Record<string, string>>({});

	function displayText(cue: SubtitleCue): string {
		return draftTexts[cue.id] ?? cue.text;
	}

	function commitText(item: TimelineItem, cueId: string): void {
		const next = draftTexts[cueId];
		delete draftTexts[cueId];
		const cues = item.cues;
		if (next === undefined || !cues) return;
		const current = cues.find((cue) => cue.id === cueId);
		if (!current || next === current.text) return;
		execute('EDIT_CUE', () => {
			timelineStore._updateItems([
				{
					id: item.id,
					patch: {
						cues: cues.map((cue) => (cue.id === cueId ? { ...cue, text: next } : cue))
					}
				}
			]);
		});
		onedit();
	}

	function deleteCue(item: TimelineItem, cueId: string): void {
		const cues = item.cues;
		if (!cues?.some((cue) => cue.id === cueId)) return;
		execute('DELETE_CUE', () => {
			const remaining = cues.filter((cue) => cue.id !== cueId);
			timelineStore._updateItems([
				{ id: item.id, patch: { cues: remaining.length > 0 ? remaining : undefined } }
			]);
		});
		onedit();
	}
</script>

<div class="flex flex-col gap-1">
	<h3 class="px-1 text-xs font-medium tracking-wide text-[oklch(0.65_0.015_55)] uppercase">
		{m.video_editor_transcript()}
	</h3>
	{#if subtitleItems.length === 0}
		<p class="px-1 text-xs text-[oklch(0.65_0.015_55)]">{m.video_editor_transcript_empty()}</p>
	{:else}
		{#each subtitleItems as item (item.id)}
			<ul class="flex flex-col gap-0.5" aria-label={item.label}>
				{#each item.cues ?? [] as cue (cue.id)}
					<li class="flex items-center gap-1">
						<input
							class="min-w-0 flex-1 rounded bg-[oklch(0.22_0.01_50)] px-1 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
							value={displayText(cue)}
							aria-label={m.video_editor_transcript_line()}
							onclick={() => setCurrentFrame(cue.startFrame)}
							oninput={(event) => {
								draftTexts[cue.id] = event.currentTarget.value;
							}}
							onblur={() => commitText(item, cue.id)}
							onkeydown={(event) => {
								if (event.key === 'Enter') event.currentTarget.blur();
							}}
						/>
						<button
							type="button"
							class="rounded p-0.5 hover:bg-[oklch(0.28_0.015_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
							aria-label={m.video_editor_transcript_delete_line()}
							onclick={() => deleteCue(item, cue.id)}
						>
							<Trash2Icon class="size-3" />
						</button>
					</li>
				{/each}
			</ul>
		{/each}
	{/if}
</div>
