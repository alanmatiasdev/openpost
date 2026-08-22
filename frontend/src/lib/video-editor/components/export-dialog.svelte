<!-- Export controls for container, quality, range, subtitles, progress, and cancel. -->
<script lang="ts">
	import { canEncodeVideo, type VideoCodec } from 'mediabunny';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import type { Project } from '$lib/video-editor/project/types';
	import {
		renderMultiTrackVideo,
		renderTimelineAudio,
		defaultVideoCodec,
		supportedExportVideoCodecs,
		type RenderExportOptions,
		type RenderExportResult
	} from '$lib/video-editor/media/render-export';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';

	let {
		project,
		disabled,
		ondone,
		onerror
	}: {
		project: Project | null;
		disabled?: boolean;
		ondone: (result: RenderExportResult) => void;
		onerror: (error: Error) => void;
	} = $props();

	let open = $state(false);
	let rendering = $state(false);
	let format = $state<NonNullable<RenderExportOptions['format']> | 'mp3' | 'aac' | 'wav'>('webm');
	let quality = $state<NonNullable<RenderExportOptions['quality']>>('standard');
	let codec = $state<VideoCodec>('vp9');
	let codecSupport = $state<Partial<Record<VideoCodec, boolean>>>({});
	let resolution = $state('source');
	let useRange = $state(false);
	let subtitleMode = $state<NonNullable<RenderExportOptions['subtitleMode']>>('burn');
	let progress = $state<{ done: number; total: number } | null>(null);
	let controller = $state<AbortController | null>(null);
	const videoFormat = $derived(
		format === 'mp3' || format === 'aac' || format === 'wav' ? null : format
	);
	const codecs = $derived(videoFormat ? supportedExportVideoCodecs(videoFormat) : []);

	$effect(() => {
		const selectedFormat = videoFormat;
		const selectedResolution = resolution;
		if (!selectedFormat || !project) return;
		const [width, height] =
			selectedResolution === 'source'
				? [project.metadata.width, project.metadata.height]
				: selectedResolution.split('x').map(Number);
		const availableCodecs = supportedExportVideoCodecs(selectedFormat);
		if (!availableCodecs.includes(codec)) codec = defaultVideoCodec(selectedFormat);
		const requestFormat = selectedFormat;
		void Promise.all(
			availableCodecs.map(
				async (candidate) =>
					[candidate, await canEncodeVideo(candidate, { width, height })] as const
			)
		).then((results) => {
			if (videoFormat !== requestFormat) return;
			codecSupport = Object.fromEntries(results);
			if (codecSupport[codec] === false) {
				const fallback = results.find(([, supported]) => supported)?.[0];
				if (fallback) codec = fallback;
			}
		});
	});

	async function start(): Promise<void> {
		if (!project || rendering) return;
		rendering = true;
		progress = null;
		controller = new AbortController();
		const [width, height] =
			resolution === 'source'
				? [project.metadata.width, project.metadata.height]
				: resolution.split('x').map(Number);
		try {
			const range =
				useRange && timelineStore.inPoint !== null && timelineStore.outPoint !== null
					? { startFrame: timelineStore.inPoint, endFrame: timelineStore.outPoint }
					: undefined;
			const result =
				format === 'mp3' || format === 'aac' || format === 'wav'
					? await renderTimelineAudio(project, { format, range, signal: controller.signal })
					: await renderMultiTrackVideo(project, {
							format,
							codec,
							quality,
							width,
							height,
							subtitleMode,
							range,
							signal: controller.signal,
							onProgress: (value) => {
								progress = { done: value.framesDone, total: value.totalFrames };
							}
						});
			ondone(result);
			open = false;
		} catch (cause) {
			if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
				onerror(cause instanceof Error ? cause : new Error(String(cause)));
			}
		} finally {
			rendering = false;
			progress = null;
			controller = null;
		}
	}
</script>

<Button size="sm" variant="secondary" class="w-full" {disabled} onclick={() => (open = true)}>
	{m.video_editor_export_render()}
</Button>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget && !rendering) open = false;
		}}
	>
		<div
			class="w-full max-w-md rounded-xl border border-[oklch(0.3_0.015_55)] bg-[oklch(0.17_0.01_55)] p-4 shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="export-title"
		>
			<h2 id="export-title" class="text-base font-semibold">{m.video_editor_export_title()}</h2>
			<div class="mt-4 grid grid-cols-2 gap-3">
				<label class="text-xs text-[oklch(0.7_0.01_55)]"
					>{m.video_editor_export_format()}<select
						class="mt-1 w-full rounded bg-[oklch(0.23_0.01_50)] p-2 text-sm"
						bind:value={format}
						disabled={rendering}
						><option value="mp4">MP4</option><option value="mov">MOV</option><option value="webm"
							>WebM</option
						><option value="mkv">MKV</option><optgroup label={m.video_editor_export_audio_only()}
							><option value="mp3">MP3</option><option value="aac">AAC</option><option value="wav"
								>WAV</option
							></optgroup
						></select
					></label
				>
				{#if videoFormat}
					<label class="text-xs text-[oklch(0.7_0.01_55)]"
						>{m.video_editor_export_codec()}<select
							class="mt-1 w-full rounded bg-[oklch(0.23_0.01_50)] p-2 text-sm"
							bind:value={codec}
							disabled={rendering}
							>{#each codecs as candidate}
								<option value={candidate} disabled={codecSupport[candidate] === false}>
									{candidate.toUpperCase()}{codecSupport[candidate] === false
										? ` ${m.video_editor_export_codec_unavailable()}`
										: ''}
								</option>
							{/each}</select
						></label
					>
				{/if}
				<label class="text-xs text-[oklch(0.7_0.01_55)]"
					>{m.video_editor_export_quality()}<select
						class="mt-1 w-full rounded bg-[oklch(0.23_0.01_50)] p-2 text-sm"
						bind:value={quality}
						disabled={rendering}
						><option value="draft">{m.video_editor_export_quality_draft()}</option><option
							value="standard">{m.video_editor_export_quality_standard()}</option
						><option value="high">{m.video_editor_export_quality_high()}</option></select
					></label
				>
				<label class="text-xs text-[oklch(0.7_0.01_55)]"
					>{m.video_editor_export_resolution()}<select
						class="mt-1 w-full rounded bg-[oklch(0.23_0.01_50)] p-2 text-sm"
						bind:value={resolution}
						disabled={rendering}
						><option value="source">{project?.metadata.width} × {project?.metadata.height}</option
						><option value="1920x1080">1920 × 1080</option><option value="1280x720"
							>1280 × 720</option
						><option value="854x480">854 × 480</option></select
					></label
				>
				<label class="text-xs text-[oklch(0.7_0.01_55)]"
					>{m.video_editor_export_subtitles()}<select
						class="mt-1 w-full rounded bg-[oklch(0.23_0.01_50)] p-2 text-sm"
						bind:value={subtitleMode}
						disabled={rendering}
						><option value="none">{m.video_editor_export_subtitles_none()}</option><option
							value="burn">{m.video_editor_export_subtitles_burn()}</option
						><option value="sidecar">{m.video_editor_export_subtitles_sidecar()}</option><option
							value="embedded">{m.video_editor_export_subtitles_embedded()}</option
						></select
					></label
				>
			</div>
			<label class="mt-3 flex min-h-11 items-center gap-2 text-sm"
				><input
					type="checkbox"
					bind:checked={useRange}
					disabled={rendering || timelineStore.inPoint === null || timelineStore.outPoint === null}
				/>{m.video_editor_export_range()}</label
			>
			{#if progress}<div class="mt-2" role="status">
					<p class="text-center text-xs text-[oklch(0.7_0.01_55)]">
						{m.video_editor_render_progress({ done: progress.done, total: progress.total })}
					</p>
					<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-[oklch(0.25_0.015_55)]">
						<div
							class="h-full bg-[oklch(0.66_0.14_45)]"
							style="width: {Math.round((progress.done / Math.max(1, progress.total)) * 100)}%"
						></div>
					</div>
				</div>{/if}
			<div class="mt-4 flex justify-end gap-2">
				<Button
					variant="ghost"
					disabled={rendering && !controller}
					onclick={() => {
						if (rendering) controller?.abort();
						else open = false;
					}}>{m.video_editor_export_cancel()}</Button
				><Button disabled={rendering} onclick={start}>{m.video_editor_export_start()}</Button>
			</div>
		</div>
	</div>
{/if}
