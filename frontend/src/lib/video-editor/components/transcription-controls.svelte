<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import LocalModelCacheControl from './local-model-cache-control.svelte';
	import {
		DEFAULT_TRANSCRIPTION_MODEL,
		TRANSCRIPTION_LANGUAGE_OPTIONS,
		TRANSCRIPTION_MODEL_OPTIONS,
		TRANSCRIPTION_QUANTIZATION_OPTIONS,
		transcriptionModelLabel
	} from '$lib/video-editor/transcript/engine/models';
	import type {
		ResolvedTranscriptionEngine,
		TranscribeProgress,
		TranscriptionModel,
		TranscriptionQuantization,
		TranscriptionSelection
	} from '$lib/video-editor/transcript/engine/types';

	let {
		canTranscribe,
		busy,
		progress,
		backend,
		fallback,
		onstart,
		oncancel
	}: {
		canTranscribe: boolean;
		busy: boolean;
		progress: TranscribeProgress | null;
		backend: 'webgpu' | 'wasm' | null;
		fallback: ResolvedTranscriptionEngine | null;
		onstart: (selection: TranscriptionSelection) => void;
		oncancel: () => void;
	} = $props();

	let model = $state<TranscriptionModel>(DEFAULT_TRANSCRIPTION_MODEL);
	let language = $state('');
	let quantization = $state<TranscriptionQuantization>('hybrid');

	function formatBytes(bytes: number): string {
		if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
	}

	function stageLabel(value: TranscribeProgress): string {
		if (value.stage === 'downloading') return m.video_editor_transcribe_downloading();
		if (value.stage === 'preparing') return m.video_editor_transcribe_preparing();
		if (value.stage === 'decoding') return m.video_editor_transcribe_decoding();
		return m.video_editor_transcribing();
	}

	function start(): void {
		onstart({ model, language: language || undefined, quantization });
	}
</script>

<div
	class="grid grid-cols-2 gap-1 rounded-md border border-[oklch(0.25_0.015_55)] bg-[oklch(0.17_0.008_55)] p-1.5"
>
	<label class="col-span-2 text-[10px] text-[oklch(0.66_0.015_55)]">
		{m.video_editor_transcribe_model()}
		<select
			class="mt-0.5 w-full rounded border border-[oklch(0.29_0.015_55)] bg-[oklch(0.21_0.01_55)] px-1.5 py-1 text-[11px] text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
			bind:value={model}
			disabled={busy}
		>
			{#each TRANSCRIPTION_MODEL_OPTIONS as option}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
	</label>
	<label class="text-[10px] text-[oklch(0.66_0.015_55)]">
		{m.video_editor_transcribe_language()}
		<select
			class="mt-0.5 w-full rounded border border-[oklch(0.29_0.015_55)] bg-[oklch(0.21_0.01_55)] px-1 py-1 text-[11px] text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
			bind:value={language}
			disabled={busy}
		>
			{#each TRANSCRIPTION_LANGUAGE_OPTIONS as option}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
	</label>
	<label class="text-[10px] text-[oklch(0.66_0.015_55)]">
		{m.video_editor_transcribe_quality()}
		<select
			class="mt-0.5 w-full rounded border border-[oklch(0.29_0.015_55)] bg-[oklch(0.21_0.01_55)] px-1 py-1 text-[11px] text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
			bind:value={quantization}
			disabled={busy || model === 'parakeet-tdt-v3'}
		>
			{#each TRANSCRIPTION_QUANTIZATION_OPTIONS as option}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
	</label>
	<p class="col-span-2 text-[9px] leading-tight text-[oklch(0.58_0.012_55)]">
		{TRANSCRIPTION_MODEL_OPTIONS.find((option) => option.value === model)?.description}
	</p>
	{#if fallback}
		<p
			class="col-span-2 rounded bg-[oklch(0.24_0.045_65)] px-1.5 py-1 text-[10px] text-[oklch(0.84_0.08_70)]"
			role="status"
		>
			{m.video_editor_transcribe_fallback({ model: transcriptionModelLabel(fallback.model) })}
		</p>
	{/if}
	{#if busy && progress}
		<div class="col-span-2" aria-live="polite">
			<div class="mb-0.5 flex items-center justify-between text-[9px] text-[oklch(0.66_0.015_55)]">
				<span>{stageLabel(progress)}{backend ? ` · ${backend.toUpperCase()}` : ''}</span>
				<span>
					{Math.round(progress.progress * 100)}%
					{#if progress.receivedBytes != null && progress.totalBytes}
						· {formatBytes(progress.receivedBytes)} / {formatBytes(progress.totalBytes)}
					{/if}
				</span>
			</div>
			<div
				class="h-1 overflow-hidden rounded-full bg-[oklch(0.27_0.012_55)]"
				role="progressbar"
				aria-label={stageLabel(progress)}
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={Math.round(progress.progress * 100)}
			>
				<div
					class="h-full rounded-full bg-[oklch(0.66_0.14_45)] transition-[width]"
					style:width={`${Math.max(2, progress.progress * 100)}%`}
				></div>
			</div>
		</div>
	{/if}
	<Button
		size="sm"
		class="col-span-2 w-full"
		variant={busy ? 'outline' : 'secondary'}
		disabled={!canTranscribe}
		onclick={busy ? oncancel : start}
	>
		{busy ? m.video_editor_transcribe_cancel() : m.video_editor_transcribe()}
	</Button>
	<LocalModelCacheControl />
</div>
