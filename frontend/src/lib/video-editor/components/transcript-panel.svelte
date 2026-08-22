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
	import type { SubtitleCue, SubtitleWord, TimelineItem } from '$lib/video-editor/project/types';

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

	function replaceCue(item: TimelineItem, nextCue: SubtitleCue, command: string): void {
		if (!item.cues) return;
		execute(command, () => {
			timelineStore._updateItems([
				{
					id: item.id,
					patch: { cues: item.cues?.map((cue) => (cue.id === nextCue.id ? nextCue : cue)) }
				}
			]);
		});
		onedit();
	}

	function commitCueTiming(
		item: TimelineItem,
		cue: SubtitleCue,
		startFrame: number,
		endFrame: number
	): void {
		const start = Math.max(0, Math.round(startFrame));
		const end = Math.max(start + 1, Math.round(endFrame));
		if (start === cue.startFrame && end === cue.endFrame) return;
		replaceCue(item, { ...cue, startFrame: start, endFrame: end }, 'EDIT_CUE_TIMING');
	}

	function updateWord(
		item: TimelineItem,
		cue: SubtitleCue,
		wordId: string,
		patch: Partial<SubtitleWord>
	): void {
		const words = cue.words;
		if (!words) return;
		const nextWords = words.map((word) => (word.id === wordId ? { ...word, ...patch } : word));
		const first = nextWords[0];
		const last = nextWords[nextWords.length - 1];
		replaceCue(
			item,
			{
				...cue,
				words: nextWords,
				text: nextWords.map((word) => word.text).join(' '),
				startFrame: first?.startFrame ?? cue.startFrame,
				endFrame: last?.endFrame ?? cue.endFrame
			},
			'EDIT_TRANSCRIPT_WORD'
		);
	}

	function deleteWord(item: TimelineItem, cue: SubtitleCue, wordId: string): void {
		const words = cue.words?.filter((word) => word.id !== wordId);
		if (!words) return;
		if (words.length === 0) {
			deleteCue(item, cue.id);
			return;
		}
		const first = words[0]!;
		const last = words[words.length - 1]!;
		replaceCue(
			item,
			{
				...cue,
				words,
				text: words.map((word) => word.text).join(' '),
				startFrame: first.startFrame,
				endFrame: last.endFrame
			},
			'DELETE_TRANSCRIPT_WORD'
		);
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
					<li class="rounded bg-[oklch(0.19_0.01_50)] p-1">
						<div class="flex items-center gap-1">
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
						</div>
						<div class="mt-1 grid grid-cols-2 gap-1">
							<label class="text-[9px] text-[oklch(0.62_0.01_55)]"
								>{m.video_editor_property_start()}<input
									class="mt-0.5 w-full rounded bg-[oklch(0.24_0.01_50)] px-1 py-0.5 text-[10px]"
									type="number"
									min="0"
									value={cue.startFrame}
									onblur={(event) =>
										commitCueTiming(item, cue, event.currentTarget.valueAsNumber, cue.endFrame)}
								/></label
							>
							<label class="text-[9px] text-[oklch(0.62_0.01_55)]"
								>{m.video_editor_property_end()}<input
									class="mt-0.5 w-full rounded bg-[oklch(0.24_0.01_50)] px-1 py-0.5 text-[10px]"
									type="number"
									min={cue.startFrame + 1}
									value={cue.endFrame}
									onblur={(event) =>
										commitCueTiming(item, cue, cue.startFrame, event.currentTarget.valueAsNumber)}
								/></label
							>
						</div>
						{#if cue.words?.length}
							<div class="mt-1 flex flex-wrap gap-1">
								{#each cue.words as word (word.id)}
									<div
										class="group rounded border border-[oklch(0.3_0.015_55)] bg-[oklch(0.23_0.01_50)] p-1"
									>
										<input
											class="w-16 bg-transparent text-[10px] outline-none"
											value={word.text}
											aria-label={m.video_editor_transcript_word()}
											onfocus={() => setCurrentFrame(word.startFrame)}
											onblur={(event) => {
												if (event.currentTarget.value !== word.text)
													updateWord(item, cue, word.id, { text: event.currentTarget.value });
											}}
										/>
										<div class="mt-0.5 flex items-center gap-0.5">
											<input
												class="w-10 bg-transparent text-[8px] text-[oklch(0.62_0.01_55)]"
												type="number"
												value={word.startFrame}
												aria-label={m.video_editor_transcript_word_start()}
												onblur={(event) =>
													updateWord(item, cue, word.id, {
														startFrame: Math.max(0, event.currentTarget.valueAsNumber)
													})}
											/><span class="text-[8px]">-</span><input
												class="w-10 bg-transparent text-[8px] text-[oklch(0.62_0.01_55)]"
												type="number"
												value={word.endFrame}
												aria-label={m.video_editor_transcript_word_end()}
												onblur={(event) =>
													updateWord(item, cue, word.id, {
														endFrame: Math.max(
															word.startFrame + 1,
															event.currentTarget.valueAsNumber
														)
													})}
											/><button
												type="button"
												class="ml-auto text-[9px] opacity-60 hover:opacity-100"
												aria-label={m.video_editor_transcript_word_delete()}
												onclick={(event) => {
													event.stopPropagation();
													deleteWord(item, cue, word.id);
												}}>×</button
											>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/each}
	{/if}
</div>
