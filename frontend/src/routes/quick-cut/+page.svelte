<!--
Quick Cut: fast lossless trimming. Open a file, mark in/out, export the
selected range without re-encoding (mediabunny stream copy). UX inspired by
LosslessCut (GPL — behavioral reference only, no code ported).
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import Logo from '$lib/components/Logo.svelte';
	import { showToast } from '$lib/toast';
	import {
		ALL_FORMATS,
		BlobSource,
		BufferTarget,
		Conversion,
		Input,
		Mp4OutputFormat,
		Output,
		WebMOutputFormat
	} from 'mediabunny';

	interface Segment {
		id: string;
		start: number;
		end: number;
	}

	let file = $state<File | null>(null);
	let fileUrl = $state('');
	let duration = $state(0);
	let videoEl = $state<HTMLVideoElement | null>(null);
	let currentTime = $state(0);
	let playing = $state(false);
	let inPoint = $state<number | null>(null);
	let outPoint = $state<number | null>(null);
	let segments = $state<Segment[]>([]);
	let exporting = $state(false);

	async function openFile(): Promise<void> {
		const [handle] =
			(await window.showOpenFilePicker?.({
				multiple: false,
				types: [
					{
						description: 'Video',
						accept: { 'video/*': ['.mp4', '.webm', '.mov', '.mkv', '.m4v'] }
					}
				]
			})) ?? [];
		if (!handle) return;
		const picked = await handle.getFile();
		file = picked;
		fileUrl = URL.createObjectURL(picked);
		inPoint = null;
		outPoint = null;
		segments = [];

		try {
			const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(picked) });
			duration = await input.computeDuration();
			input.dispose?.();
		} catch {
			duration = 0;
		}
	}

	function timecode(seconds: number): string {
		const minutes = Math.floor(seconds / 60);
		const rest = seconds % 60;
		return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`;
	}

	function seekTo(seconds: number): void {
		if (videoEl) videoEl.currentTime = Math.min(Math.max(0, seconds), duration || 0);
	}

	function markIn(): void {
		inPoint = currentTime;
		if (outPoint !== null && outPoint <= inPoint) outPoint = null;
	}

	function markOut(): void {
		outPoint = currentTime;
	}

	function addSegment(): void {
		if (inPoint === null || outPoint === null || outPoint <= inPoint) {
			showToast(m.quick_cut_need_range(), 'error');
			return;
		}
		segments = [...segments, { id: crypto.randomUUID(), start: inPoint, end: outPoint }];
		inPoint = null;
		outPoint = null;
	}

	function removeSegment(id: string): void {
		segments = segments.filter((segment) => segment.id !== id);
	}

	function togglePlay(): void {
		if (!videoEl) return;
		if (playing) videoEl.pause();
		else void videoEl.play();
	}

	async function exportSegment(segment: Segment): Promise<void> {
		if (!file || exporting) return;
		exporting = true;
		try {
			const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
			const isWebm = file.type === 'video/webm';
			const target = new BufferTarget();
			const conversion = await Conversion.init({
				input,
				output: new Output({
					format: isWebm ? new WebMOutputFormat() : new Mp4OutputFormat(),
					target
				}),
				trim: { start: segment.start, end: segment.end },
				video: { forceTranscode: false },
				audio: { forceTranscode: false }
			});
			if (!conversion.isValid) throw new Error(m.quick_cut_not_lossless());
			await conversion.execute();
			input.dispose?.();

			const buffer = target.buffer;
			if (!buffer) throw new Error('No output');
			const blob = new Blob([buffer], { type: isWebm ? 'video/webm' : 'video/mp4' });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			const base = file.name.replace(/\.[^.]+$/, '');
			anchor.download = `${base} [${segment.start.toFixed(2)}-${segment.end.toFixed(2)}].${isWebm ? 'webm' : 'mp4'}`;
			anchor.click();
			setTimeout(() => URL.revokeObjectURL(url), 5000);
			showToast(m.quick_cut_saved(), 'success');
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		} finally {
			exporting = false;
		}
	}

	function onKeydown(event: KeyboardEvent): void {
		// SAFETY: event targets on this page are HTML elements.
		if ((event.target as HTMLElement)?.tagName === 'INPUT') return;
		if (event.key === 'i' || event.key === 'I') markIn();
		else if (event.key === 'o' || event.key === 'O') markOut();
		else if (event.code === 'Space') {
			event.preventDefault();
			togglePlay();
		}
	}
</script>

<svelte:head>
	<title>{m.quick_cut_title()}</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<div class="flex min-h-dvh flex-col bg-[oklch(0.145_0.008_55)] text-[oklch(0.92_0.005_85)]">
	<header
		class="flex items-center justify-between border-b border-[oklch(0.25_0.015_55)] px-3 py-2"
	>
		<a
			href="/editors"
			class="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
		>
			<Logo class="h-5 w-auto" />
			<span class="text-sm font-semibold">{m.quick_cut_title()}</span>
		</a>
		<span class="hidden text-xs text-[oklch(0.65_0.015_55)] sm:block">{m.quick_cut_tagline()}</span>
	</header>

	<main class="flex flex-1 flex-col items-center gap-3 p-4">
		{#if !file}
			<div class="mt-16 text-center">
				<h1 class="text-lg font-semibold">{m.quick_cut_empty_title()}</h1>
				<p class="mx-auto mt-2 max-w-md text-sm text-[oklch(0.65_0.015_55)]">
					{m.quick_cut_empty_body()}
				</p>
				<Button class="mt-6" onclick={openFile}>{m.quick_cut_open()}</Button>
			</div>
		{:else}
			<div class="w-full max-w-4xl">
				<!-- svelte-ignore a11y_media_has_caption -- trim preview; captions are not part of lossless cuts -->
				<video
					bind:this={videoEl}
					src={fileUrl}
					class="max-h-[55dvh] w-full rounded-lg bg-black"
					playsinline
					ontimeupdate={() => {
						if (videoEl) currentTime = videoEl.currentTime;
					}}
					onplay={() => (playing = true)}
					onpause={() => (playing = false)}
				></video>

				<div class="mt-3 flex flex-wrap items-center gap-2">
					<span class="rounded bg-[oklch(0.18_0.008_55)] px-2 py-1 font-mono text-xs tabular-nums">
						{timecode(currentTime)} / {timecode(duration)}
					</span>
					<Button size="xs" variant="outline" onclick={markIn}>I · {m.quick_cut_in()}</Button>
					{#if inPoint !== null}
						<span class="font-mono text-xs text-[oklch(0.66_0.14_45)]">{timecode(inPoint)}</span>
					{/if}
					<Button size="xs" variant="outline" onclick={markOut}>O · {m.quick_cut_out()}</Button>
					{#if outPoint !== null}
						<span class="font-mono text-xs text-[oklch(0.66_0.14_45)]">{timecode(outPoint)}</span>
					{/if}
					<Button size="xs" onclick={addSegment}>{m.quick_cut_add_segment()}</Button>
					<div class="ml-auto flex gap-1">
						<Button size="xs" variant="ghost" onclick={() => seekTo(currentTime - 1 / 30)}
							>◀◀</Button
						>
						<Button
							size="icon-xs"
							aria-label={playing ? m.video_editor_pause() : m.video_editor_play()}
							onclick={togglePlay}
						>
							{playing ? '❚❚' : '▶'}
						</Button>
						<Button size="xs" variant="ghost" onclick={() => seekTo(currentTime + 1 / 30)}
							>▶▶</Button
						>
					</div>
				</div>

				<ul class="mt-4 flex flex-col gap-2" role="list">
					{#each segments as segment (segment.id)}
						<li
							class="flex items-center gap-3 rounded-lg border border-[oklch(0.25_0.015_55)] bg-[oklch(0.2_0.01_50)] p-2"
						>
							<span class="font-mono text-xs">
								{timecode(segment.start)} → {timecode(segment.end)}
								({(segment.end - segment.start).toFixed(1)}s)
							</span>
							<div class="ml-auto flex gap-1">
								<Button
									size="xs"
									variant="ghost"
									onclick={() => {
										seekTo(segment.start);
										videoEl?.play();
									}}
								>
									{m.quick_cut_preview()}
								</Button>
								<Button size="xs" disabled={exporting} onclick={() => exportSegment(segment)}>
									{m.quick_cut_export()}
								</Button>
								<Button
									size="icon-xs"
									variant="ghost"
									aria-label={m.video_editor_project_delete()}
									onclick={() => removeSegment(segment.id)}
								>
									×
								</Button>
							</div>
						</li>
					{/each}
				</ul>

				{#if segments.length > 1 && !exporting}
					<Button
						class="mt-3"
						size="sm"
						variant="secondary"
						onclick={() => {
							for (const segment of segments) void exportSegment(segment);
						}}
					>
						{m.quick_cut_export_all()}
					</Button>
				{/if}
			</div>
		{/if}
	</main>
</div>
