<!--
	Transcript panel: cue rows for every subtitle item. Clicking a row seeks
	to the cue start; text edits commit on blur as one undoable step.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import BoldIcon from '@lucide/svelte/icons/bold';
	import ItalicIcon from '@lucide/svelte/icons/italic';
	import UnderlineIcon from '@lucide/svelte/icons/underline';
	import ScissorsIcon from '@lucide/svelte/icons/scissors';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { setCurrentFrame } from '$lib/video-editor/timeline/actions/items';
	import { execute } from '$lib/video-editor/timeline/commands/command-store.svelte';
	import type { SubtitleCue, SubtitleWord, TimelineItem } from '$lib/video-editor/project/types';
	import {
		buildCueText,
		getCueFormatFlags,
		parseSubtitleCueText,
		toggleCueFormat,
		type CueFormatFlags
	} from '$lib/video-editor/transcript/subtitle-cue-format';
	import { collectTranscriptSourceWords } from '$lib/video-editor/transcript/speech-cleanup';
	import { applyTranscriptWordRemoval } from '$lib/video-editor/transcript/speech-cleanup-actions';
	import { sourceSecondsToTimelineFrame } from '$lib/video-editor/timeline/utils/media-item-frames';

	let { onedit }: { onedit: () => void } = $props();

	const subtitleItems = $derived(timelineStore.items.filter((item) => item.type === 'subtitle'));

	/** In-flight inline edits keyed by cue id; committed to the store on blur. */
	let draftTexts = $state<Record<string, string>>({});
	let editVideoMode = $state(false);
	let selectedSourceWordIds = $state<Set<string>>(new Set());
	const sourceMediaItemIds = $derived(
		timelineStore.items
			.filter((item) => item.type === 'video' || item.type === 'audio')
			.map((item) => item.id)
	);
	const sourceWords = $derived(
		collectTranscriptSourceWords(timelineStore.items, sourceMediaItemIds, timelineStore.fps)
	);
	const sourceWordByUiId = $derived(new Map(sourceWords.map((word) => [word.id, word])));
	const selectedSourceWords = $derived(
		sourceWords.filter((word) => selectedSourceWordIds.has(word.id))
	);

	function displayText(cue: SubtitleCue): string {
		return draftTexts[cue.id] ?? parseSubtitleCueText(cue.text).plainText;
	}

	function commitText(item: TimelineItem, cueId: string): void {
		const next = draftTexts[cueId];
		delete draftTexts[cueId];
		const cues = item.cues;
		if (next === undefined || !cues) return;
		const current = cues.find((cue) => cue.id === cueId);
		if (!current || next === parseSubtitleCueText(current.text).plainText) return;
		const formattedText = buildCueText(
			next,
			getCueFormatFlags(parseSubtitleCueText(current.text)),
			current.text
		);
		execute('EDIT_CUE', () => {
			timelineStore._updateItems([
				{
					id: item.id,
					patch: {
						cues: cues.map((cue) => (cue.id === cueId ? { ...cue, text: formattedText } : cue))
					}
				}
			]);
		});
		onedit();
	}

	function cueFlags(cue: SubtitleCue): CueFormatFlags {
		return getCueFormatFlags(parseSubtitleCueText(cue.text));
	}

	function toggleFormat(item: TimelineItem, cue: SubtitleCue, format: keyof CueFormatFlags): void {
		const currentItem = timelineStore.itemById.get(item.id) ?? item;
		const currentCue = currentItem.cues?.find((candidate) => candidate.id === cue.id) ?? cue;
		replaceCue(
			currentItem,
			{ ...currentCue, text: toggleCueFormat(currentCue.text, format) },
			'TOGGLE_CUE_FORMAT'
		);
	}

	function deleteCue(item: TimelineItem, cueId: string): void {
		const cues = item.cues;
		if (!cues?.some((cue) => cue.id === cueId)) return;
		execute('DELETE_CUE', () => {
			const remaining = cues.filter((cue) => cue.id !== cueId);
			timelineStore._updateItems([
				{
					id: item.id,
					patch: { cues: remaining.length > 0 ? remaining : undefined }
				}
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
					patch: {
						cues: item.cues?.map((cue) => (cue.id === nextCue.id ? nextCue : cue))
					}
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
				text: buildCueText(nextWords.map((word) => word.text).join(' '), cueFlags(cue), cue.text),
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
				text: buildCueText(words.map((word) => word.text).join(' '), cueFlags(cue), cue.text),
				startFrame: first.startFrame,
				endFrame: last.endFrame
			},
			'DELETE_TRANSCRIPT_WORD'
		);
	}

	function toggleVideoWord(id: string): void {
		const next = new Set(selectedSourceWordIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedSourceWordIds = next;
		const word = sourceWordByUiId.get(id);
		if (!word) return;
		const source = timelineStore.items.find(
			(item) => (item.type === 'video' || item.type === 'audio') && item.mediaId === word.mediaId
		);
		if (source)
			setCurrentFrame(sourceSecondsToTimelineFrame(source, word.start, timelineStore.fps));
	}

	function deleteSelectedVideoWords(): void {
		if (selectedSourceWords.length === 0) return;
		const mediaIds = new Set(selectedSourceWords.map((word) => word.mediaId));
		const itemIds = timelineStore.items
			.filter(
				(item) =>
					(item.type === 'video' || item.type === 'audio') &&
					item.mediaId !== undefined &&
					mediaIds.has(item.mediaId)
			)
			.map((item) => item.id);
		const result = applyTranscriptWordRemoval(itemIds, selectedSourceWords);
		if (result.removedItemCount === 0) return;
		selectedSourceWordIds = new Set();
		onedit();
	}
</script>

<div class="video-editor-theme flex flex-col gap-1">
	<div class="flex items-center justify-between gap-2 px-1">
		<h3 class="text-xs font-medium tracking-wide text-[oklch(0.65_0.015_55)] uppercase">
			{m.video_editor_transcript()}
		</h3>
		<Button
			type="button"
			variant={editVideoMode ? 'secondary' : 'ghost'}
			size="sm"
			class="h-6 px-2 text-[10px]"
			disabled={sourceWords.length === 0}
			aria-pressed={editVideoMode}
			onclick={() => {
				editVideoMode = !editVideoMode;
				selectedSourceWordIds = new Set();
			}}
		>
			<ScissorsIcon class="size-3" aria-hidden="true" />
			{m.video_editor_edit_by_transcript()}
		</Button>
	</div>
	{#if editVideoMode}
		<div
			class="mx-1 mb-1 flex items-center justify-between gap-2 rounded-md border border-[oklch(0.31_0.018_55)] bg-[oklch(0.2_0.012_50)] px-2 py-1.5"
		>
			<span class="text-[10px] text-[oklch(0.68_0.012_55)]">
				{m.video_editor_transcript_words_selected({ count: selectedSourceWords.length })}
			</span>
			<Button
				type="button"
				size="sm"
				class="h-6 px-2 text-[10px]"
				disabled={selectedSourceWords.length === 0}
				onclick={deleteSelectedVideoWords}
			>
				{m.video_editor_delete_selected_words()}
			</Button>
		</div>
	{/if}
	{#if subtitleItems.length === 0}
		<p class="px-1 text-xs text-[oklch(0.65_0.015_55)]">
			{m.video_editor_transcript_empty()}
		</p>
	{:else}
		{#each subtitleItems as item (item.id)}
			<ul class="flex flex-col gap-0.5" aria-label={item.label}>
				{#each item.cues ?? [] as cue (cue.id)}
					<li class="rounded bg-[oklch(0.19_0.01_50)] p-1">
						<div class="flex items-center gap-1">
							<Input
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
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								aria-label={m.video_editor_transcript_delete_line()}
								onclick={() => deleteCue(item, cue.id)}
							>
								<Trash2Icon class="size-3" />
							</Button>
						</div>
						<div class="mt-1 grid grid-cols-2 gap-1">
							<label class="text-[9px] text-[oklch(0.62_0.01_55)]"
								>{m.video_editor_property_start()}<Input
									class="mt-0.5 w-full rounded bg-[oklch(0.24_0.01_50)] px-1 py-0.5 text-[10px]"
									type="number"
									min="0"
									value={cue.startFrame}
									onblur={(event) =>
										commitCueTiming(item, cue, event.currentTarget.valueAsNumber, cue.endFrame)}
								/></label
							>
							<label class="text-[9px] text-[oklch(0.62_0.01_55)]"
								>{m.video_editor_property_end()}<Input
									class="mt-0.5 w-full rounded bg-[oklch(0.24_0.01_50)] px-1 py-0.5 text-[10px]"
									type="number"
									min={cue.startFrame + 1}
									value={cue.endFrame}
									onblur={(event) =>
										commitCueTiming(item, cue, cue.startFrame, event.currentTarget.valueAsNumber)}
								/></label
							>
						</div>
						<div class="mt-1 flex gap-0.5" role="group" aria-label={m.video_editor_caption_style()}>
							<Button
								type="button"
								variant={cueFlags(cue).bold ? 'secondary' : 'ghost'}
								size="icon-xs"
								aria-label={m.video_editor_caption_bold()}
								aria-pressed={cueFlags(cue).bold}
								onclick={() => toggleFormat(item, cue, 'bold')}
							>
								<BoldIcon class="size-3" aria-hidden="true" />
							</Button>
							<Button
								type="button"
								variant={cueFlags(cue).italic ? 'secondary' : 'ghost'}
								size="icon-xs"
								aria-label={m.video_editor_text_italic()}
								aria-pressed={cueFlags(cue).italic}
								onclick={() => toggleFormat(item, cue, 'italic')}
							>
								<ItalicIcon class="size-3" aria-hidden="true" />
							</Button>
							<Button
								type="button"
								variant={cueFlags(cue).underline ? 'secondary' : 'ghost'}
								size="icon-xs"
								aria-label={m.video_editor_text_underline()}
								aria-pressed={cueFlags(cue).underline}
								onclick={() => toggleFormat(item, cue, 'underline')}
							>
								<UnderlineIcon class="size-3" aria-hidden="true" />
							</Button>
						</div>
						{#if cue.words?.length}
							<div class="mt-1 flex flex-wrap gap-1">
								{#each cue.words as word (word.id)}
									<div
										class="group rounded border border-[oklch(0.3_0.015_55)] bg-[oklch(0.23_0.01_50)] p-1"
									>
										{#if editVideoMode && sourceWordByUiId.has(`${item.id}:${cue.id}:${word.id}`)}
											<button
												type="button"
												class={`min-h-6 w-full rounded px-1 text-left text-[10px] ${
													selectedSourceWordIds.has(`${item.id}:${cue.id}:${word.id}`)
														? 'bg-[var(--video-editor-focus)] font-medium text-black'
														: ''
												}`}
												data-selected={selectedSourceWordIds.has(`${item.id}:${cue.id}:${word.id}`)}
												aria-pressed={selectedSourceWordIds.has(`${item.id}:${cue.id}:${word.id}`)}
												aria-label={m.video_editor_delete_transcript_word({ word: word.text })}
												onclick={() => toggleVideoWord(`${item.id}:${cue.id}:${word.id}`)}
											>
												{word.text}
											</button>
										{:else}<Input
												class="w-16 bg-transparent text-[10px] outline-none"
												value={word.text}
												aria-label={m.video_editor_transcript_word()}
												onfocus={() => setCurrentFrame(word.startFrame)}
												onblur={(event) => {
													if (event.currentTarget.value !== word.text)
														updateWord(item, cue, word.id, {
															text: event.currentTarget.value
														});
												}}
											/>{/if}
										{#if !editVideoMode}<div class="mt-0.5 flex items-center gap-0.5">
												<Input
													class="w-10 bg-transparent text-[8px] text-[oklch(0.62_0.01_55)]"
													type="number"
													value={word.startFrame}
													aria-label={m.video_editor_transcript_word_start()}
													onblur={(event) =>
														updateWord(item, cue, word.id, {
															startFrame: Math.max(0, event.currentTarget.valueAsNumber)
														})}
												/><span class="text-[8px]">-</span><Input
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
												/><Button
													type="button"
													variant="ghost"
													size="icon-xs"
													class="ml-auto"
													aria-label={m.video_editor_transcript_word_delete()}
													onclick={(event) => {
														event.stopPropagation();
														deleteWord(item, cue, word.id);
													}}
												>
													<Trash2Icon class="size-3" aria-hidden="true" />
												</Button>
											</div>{/if}
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
