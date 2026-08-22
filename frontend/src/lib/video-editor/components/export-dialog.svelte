<!-- Export controls for container, quality, range, subtitles, progress, and cancel. -->
<script lang="ts">
	import { canEncodeVideo, type VideoCodec } from 'mediabunny';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import AppSelect from '$lib/components/app-select.svelte';
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
	const formatOptions = $derived([
		{ value: 'mp4', label: 'MP4' },
		{ value: 'mov', label: 'MOV' },
		{ value: 'webm', label: 'WebM' },
		{ value: 'mkv', label: 'MKV' },
		{ value: 'mp3', label: `${m.video_editor_export_audio_only()}: MP3` },
		{ value: 'aac', label: `${m.video_editor_export_audio_only()}: AAC` },
		{ value: 'wav', label: `${m.video_editor_export_audio_only()}: WAV` }
	]);
	const qualityOptions = $derived([
		{ value: 'draft', label: m.video_editor_export_quality_draft() },
		{ value: 'standard', label: m.video_editor_export_quality_standard() },
		{ value: 'high', label: m.video_editor_export_quality_high() }
	]);
	const resolutionOptions = $derived([
		{ value: 'source', label: `${project?.metadata.width} × ${project?.metadata.height}` },
		{ value: '1920x1080', label: '1920 × 1080' },
		{ value: '1280x720', label: '1280 × 720' },
		{ value: '854x480', label: '854 × 480' }
	]);
	const subtitleOptions = $derived([
		{ value: 'none', label: m.video_editor_export_subtitles_none() },
		{ value: 'burn', label: m.video_editor_export_subtitles_burn() },
		{ value: 'sidecar', label: m.video_editor_export_subtitles_sidecar() },
		{ value: 'embedded', label: m.video_editor_export_subtitles_embedded() }
	]);

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

	function setFormat(value: string): void {
		switch (value) {
			case 'mp4':
			case 'mov':
			case 'webm':
			case 'mkv':
			case 'mp3':
			case 'aac':
			case 'wav':
				format = value;
		}
	}

	function setQuality(value: string): void {
		if (value === 'draft' || value === 'standard' || value === 'high') quality = value;
	}

	function setSubtitleMode(value: string): void {
		if (value === 'none' || value === 'burn' || value === 'sidecar' || value === 'embedded') {
			subtitleMode = value;
		}
	}

	function setCodec(value: string): void {
		const next = codecs.find((candidate) => candidate === value);
		if (next) codec = next;
	}

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
				<label class="text-xs text-[oklch(0.7_0.01_55)]">
					{m.video_editor_export_format()}<AppSelect
						class="mt-1 h-9 w-full text-sm"
						value={format}
						options={formatOptions}
						disabled={rendering}
						onValueChange={setFormat}
					/>
				</label>
				{#if videoFormat}
					<label class="text-xs text-[oklch(0.7_0.01_55)]"
						>{m.video_editor_export_codec()}<AppSelect
							class="mt-1 h-9 w-full text-sm"
							value={codec}
							disabled={rendering}
							options={codecs.map((candidate) => ({
								value: candidate,
								label: `${candidate.toUpperCase()}${codecSupport[candidate] === false ? ` ${m.video_editor_export_codec_unavailable()}` : ''}`,
								disabled: codecSupport[candidate] === false
							}))}
							onValueChange={setCodec}
						/>
					</label>
				{/if}
				<label class="text-xs text-[oklch(0.7_0.01_55)]">
					{m.video_editor_export_quality()}<AppSelect
						class="mt-1 h-9 w-full text-sm"
						value={quality}
						options={qualityOptions}
						disabled={rendering}
						onValueChange={setQuality}
					/>
				</label>
				<label class="text-xs text-[oklch(0.7_0.01_55)]">
					{m.video_editor_export_resolution()}<AppSelect
						class="mt-1 h-9 w-full text-sm"
						bind:value={resolution}
						options={resolutionOptions}
						disabled={rendering}
					/>
				</label>
				<label class="text-xs text-[oklch(0.7_0.01_55)]">
					{m.video_editor_export_subtitles()}<AppSelect
						class="mt-1 h-9 w-full text-sm"
						value={subtitleMode}
						options={subtitleOptions}
						disabled={rendering}
						onValueChange={setSubtitleMode}
					/>
				</label>
			</div>
			<label class="mt-3 flex min-h-11 items-center gap-2 text-sm">
				<Checkbox
					bind:checked={useRange}
					disabled={rendering || timelineStore.inPoint === null || timelineStore.outPoint === null}
				/>{m.video_editor_export_range()}
			</label>
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
