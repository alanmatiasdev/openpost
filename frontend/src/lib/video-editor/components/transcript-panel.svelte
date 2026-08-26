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
	import SearchIcon from '@lucide/svelte/icons/search';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import XIcon from '@lucide/svelte/icons/x';
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
	import { transcriptIgnoreStore } from '$lib/video-editor/transcript/transcript-ignore-store.svelte';
	import { sourceSecondsToTimelineFrame } from '$lib/video-editor/timeline/utils/media-item-frames';
	import { findTranscriptWordMatches } from '$lib/video-editor/transcript/fuzzy-search';

	let { onedit }: { onedit: () => void } = $props();

	const subtitleItems = $derived(timelineStore.items.filter((item) => item.type === 'subtitle'));

	/** In-flight inline edits keyed by cue id; committed to the store on blur. */
	let draftTexts = $state<Record<string, string>>({});
	let editVideoMode = $state(false);
	let selectedSourceWordIds = $state<Set<string>>(new Set());
	let searchQuery = $state('');
	let activeSearchMatch = $state(0);

	interface SearchToken {
		key: string;
		text: string;
		frame: number;
	}

	const searchTokens = $derived.by(() => {
		const tokens: SearchToken[] = [];
		for (const item of subtitleItems) {
			for (const cue of item.cues ?? []) {
				if (cue.words?.length) {
					for (const word of cue.words) {
						tokens.push({
							key: `${item.id}:${cue.id}:${word.id}`,
							text: word.text,
							frame: word.startFrame
						});
					}
				} else {
					tokens.push({
						key: `${item.id}:${cue.id}`,
						text: parseSubtitleCueText(cue.text).plainText,
						frame: cue.startFrame
					});
				}
			}
		}
		return tokens;
	});
	const searchIndexByKey = $derived(
		new Map(searchTokens.map((token, index) => [token.key, index]))
	);
	const searchResult = $derived(
		findTranscriptWordMatches(
			searchTokens.map((token) => token.text),
			searchQuery
		)
	);
	const matchedSearchIndices = $derived.by(() => {
		const indices = new Set<number>();
		for (const span of searchResult.spans) {
			for (let index = span.start; index <= span.end; index++) indices.add(index);
		}
		return indices;
	});
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
	const ignoredSourceWords = $derived(
		sourceWords.filter((word) => transcriptIgnoreStore.isIgnored(word))
	);
	const selectedWordsAreIgnored = $derived(
		selectedSourceWords.length > 0 &&
			selectedSourceWords.every((word) => transcriptIgnoreStore.isIgnored(word))
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

	function updateSelectedVideoWords(): void {
		if (selectedSourceWords.length === 0) return;
		if (selectedWordsAreIgnored) transcriptIgnoreStore.restore(selectedSourceWords);
		else transcriptIgnoreStore.ignore(selectedSourceWords);
		selectedSourceWordIds = new Set();
	}

	function commitIgnoredVideoWords(): void {
		if (ignoredSourceWords.length === 0) return;
		const mediaIds = new Set(ignoredSourceWords.map((word) => word.mediaId));
		const itemIds = timelineStore.items
			.filter(
				(item) =>
					(item.type === 'video' || item.type === 'audio') &&
					item.mediaId !== undefined &&
					mediaIds.has(item.mediaId)
			)
			.map((item) => item.id);
		const result = applyTranscriptWordRemoval(itemIds, ignoredSourceWords);
		if (result.removedItemCount === 0) return;
		transcriptIgnoreStore.clear();
		selectedSourceWordIds = new Set();
		onedit();
	}

	function ignoredDurationLabel(): string {
		return `${transcriptIgnoreStore.durationSeconds.toFixed(1)}s`;
	}

	function focusSearchMatch(index: number): void {
		const count = searchResult.spans.length;
		if (count === 0) return;
		activeSearchMatch = ((index % count) + count) % count;
		const tokenIndex = searchResult.spans[activeSearchMatch]?.start;
		if (tokenIndex === undefined) return;
		const token = searchTokens[tokenIndex];
		if (!token) return;
		setCurrentFrame(token.frame);
		requestAnimationFrame(() => {
			document
				.querySelector<HTMLElement>(`[data-transcript-search-index="${tokenIndex}"]`)
				?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		});
	}
</script>

<div class="video-editor-theme flex flex-col gap-1">
	<div class="flex flex-wrap items-center justify-between gap-2 px-1">
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
	{#if subtitleItems.length > 0}
		<div class="mx-1 flex min-w-0 items-center gap-1" role="search">
			<div class="relative min-w-24 flex-1">
				<SearchIcon
					class="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-[oklch(0.58_0.01_55)]"
					aria-hidden="true"
				/>
				<Input
					class="h-7 w-full min-w-0 pr-7 pl-7 text-[10px]"
					type="search"
					value={searchQuery}
					placeholder={m.video_editor_transcript_search()}
					aria-label={m.video_editor_transcript_search()}
					oninput={(event) => {
						searchQuery = event.currentTarget.value;
						activeSearchMatch = 0;
					}}
					onkeydown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							focusSearchMatch(activeSearchMatch + (event.shiftKey ? -1 : 1));
						}
					}}
				/>
				{#if searchQuery}
					<button
						type="button"
						class="absolute top-1/2 right-1 grid size-5 -translate-y-1/2 place-items-center rounded hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
						aria-label={m.video_editor_transcript_search_clear()}
						onclick={() => {
							searchQuery = '';
							activeSearchMatch = 0;
						}}
					>
						<XIcon class="size-3" aria-hidden="true" />
					</button>
				{/if}
			</div>
			{#if searchQuery}
				<span
					class="shrink-0 text-[10px] text-[oklch(0.66_0.01_55)] tabular-nums"
					title={searchResult.approximate
						? m.video_editor_transcript_search_approximate()
						: undefined}
				>
					{#if searchResult.spans.length > 0}
						{searchResult.approximate ? '~' : ''}{activeSearchMatch + 1}/{searchResult.spans.length}
					{:else}{m.video_editor_transcript_search_empty()}{/if}
				</span>
				<div class="flex shrink-0 gap-0.5">
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						disabled={searchResult.spans.length === 0}
						aria-label={m.video_editor_transcript_search_previous()}
						onclick={() => focusSearchMatch(activeSearchMatch - 1)}
					>
						<ChevronUpIcon class="size-3" aria-hidden="true" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						disabled={searchResult.spans.length === 0}
						aria-label={m.video_editor_transcript_search_next()}
						onclick={() => focusSearchMatch(activeSearchMatch + 1)}
					>
						<ChevronDownIcon class="size-3" aria-hidden="true" />
					</Button>
				</div>
			{/if}
		</div>
	{/if}
	{#if editVideoMode}
		<div
			class="mx-1 mb-1 flex flex-col gap-2 rounded-md border border-[oklch(0.31_0.018_55)] bg-[oklch(0.2_0.012_50)] px-2 py-2"
		>
			<p class="text-[10px] leading-4 text-[oklch(0.68_0.012_55)]">
				{m.video_editor_transcript_staging_help()}
			</p>
			<div class="flex items-center justify-between gap-2">
				<span class="text-[10px] text-[oklch(0.68_0.012_55)]">
					{m.video_editor_transcript_words_selected({ count: selectedSourceWords.length })}
				</span>
				<Button
					type="button"
					size="sm"
					class="min-h-7 px-2 text-[10px]"
					disabled={selectedSourceWords.length === 0}
					onclick={updateSelectedVideoWords}
				>
					{selectedWordsAreIgnored
						? m.video_editor_restore_selected_words()
						: m.video_editor_stage_selected_words()}
				</Button>
			</div>
			{#if ignoredSourceWords.length > 0}
				<div
					class="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2"
				>
					<span class="text-[10px] font-medium text-[var(--video-editor-focus)]">
						{m.video_editor_staged_transcript_words({
							count: ignoredSourceWords.length,
							duration: ignoredDurationLabel()
						})}
					</span>
					<div class="flex gap-1">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							class="min-h-7 px-2 text-[10px]"
							onclick={() => transcriptIgnoreStore.clear()}
						>
							{m.video_editor_clear_staged_words()}
						</Button>
						<Button
							type="button"
							size="sm"
							class="min-h-7 px-2 text-[10px]"
							onclick={commitIgnoredVideoWords}
						>
							{m.video_editor_commit_staged_words()}
						</Button>
					</div>
				</div>
			{/if}
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
					{@const cueSearchIndex = searchIndexByKey.get(`${item.id}:${cue.id}`)}
					<li
						class="rounded bg-[oklch(0.19_0.01_50)] p-1 {cueSearchIndex !== undefined &&
						matchedSearchIndices.has(cueSearchIndex)
							? 'ring-1 ring-amber-500/70 ring-inset'
							: ''}"
						data-transcript-search-index={cueSearchIndex}
					>
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
									{@const searchIndex = searchIndexByKey.get(`${item.id}:${cue.id}:${word.id}`)}
									{@const sourceWord = sourceWordByUiId.get(`${item.id}:${cue.id}:${word.id}`)}
									{@const wordIgnored = sourceWord
										? transcriptIgnoreStore.isIgnored(sourceWord)
										: false}
									<div
										class="group rounded border border-[oklch(0.3_0.015_55)] bg-[oklch(0.23_0.01_50)] p-1 {searchIndex !==
											undefined && matchedSearchIndices.has(searchIndex)
											? searchResult.approximate
												? 'ring-1 ring-amber-500/40 ring-inset'
												: 'ring-1 ring-amber-500/80 ring-inset'
											: ''}"
										data-ignored={wordIgnored}
										data-transcript-search-index={searchIndex}
									>
										{#if editVideoMode && sourceWordByUiId.has(`${item.id}:${cue.id}:${word.id}`)}
											<button
												type="button"
												class={`min-h-6 w-full rounded px-1 text-left text-[10px] ${
													selectedSourceWordIds.has(`${item.id}:${cue.id}:${word.id}`)
														? 'bg-[var(--video-editor-focus)] font-medium text-black'
														: wordIgnored
															? 'text-[oklch(0.58_0.012_55)] line-through decoration-[var(--video-editor-focus)] decoration-2'
															: ''
												}`}
												data-selected={selectedSourceWordIds.has(`${item.id}:${cue.id}:${word.id}`)}
												aria-pressed={selectedSourceWordIds.has(`${item.id}:${cue.id}:${word.id}`)}
												aria-label={wordIgnored
													? m.video_editor_staged_transcript_word({ word: word.text })
													: m.video_editor_select_transcript_word({ word: word.text })}
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
