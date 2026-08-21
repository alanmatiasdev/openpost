<!--
Record: screen, camera, microphone, or combined capture saved locally.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import Logo from '$lib/components/Logo.svelte';
	import { showToast } from '$lib/toast';
	import {
		RecorderSession,
		listRecorderDevices,
		recorderMimeType,
		type RecorderSource
	} from '$lib/video-editor/recorder/recorder.svelte';

	const session = new RecorderSession();
	let cameras = $state<MediaDeviceInfo[]>([]);
	let microphones = $state<MediaDeviceInfo[]>([]);
	let source = $state<RecorderSource>('screen');
	let cameraId = $state('');
	let micId = $state('');
	let systemAudio = $state(true);
	let previewEl = $state<HTMLVideoElement | null>(null);
	let lastResult = $state<{ url: string; fileName: string; size: number } | null>(null);

	onMount(() => {
		void listRecorderDevices().then((lists) => {
			cameras = lists.cameras;
			microphones = lists.microphones;
		});
		return () => {
			const result = session.stop();
			if (result) showToast(m.record_discarded(), 'info');
		};
	});

	$effect(() => {
		if (previewEl && session.stream) {
			previewEl.srcObject = session.stream;
			void previewEl.play().catch(() => undefined);
		}
	});

	async function start(): Promise<void> {
		lastResult = null;
		try {
			await session.start(source, { cameraId, micId, systemAudio });
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		}
	}

	function stopAndSave(): void {
		const result = session.stop();
		if (!result) return;
		const extension = result.mimeType.includes('audio') ? 'weba' : 'webm';
		const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		const fileName = `recording-${source}-${stamp}.${extension}`;
		const url = URL.createObjectURL(result.blob);
		lastResult = { url, fileName, size: result.blob.size };
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = fileName;
		anchor.click();
		showToast(m.record_saved(), 'success');
	}

	const needsCamera = $derived(source === 'camera' || source === 'screen-camera');
	const hasVideo = $derived(source !== 'audio');
</script>

<svelte:head>
	<title>{m.record_title()}</title>
</svelte:head>

<div class="flex min-h-dvh flex-col bg-[oklch(0.145_0.008_55)] text-[oklch(0.92_0.005_85)]">
	<header
		class="flex items-center justify-between border-b border-[oklch(0.25_0.015_55)] px-3 py-2"
	>
		<a
			href="/editors"
			class="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
		>
			<Logo class="h-5 w-auto" />
			<span class="text-sm font-semibold">{m.record_title()}</span>
		</a>
	</header>

	<main class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
		<section
			class="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-[oklch(0.3_0.01_55)] bg-[oklch(0.12_0.008_55)]"
		>
			{#if session.stream}
				<!-- svelte-ignore a11y_media_has_caption -- local recorder preview -->
				<video bind:this={previewEl} class="max-h-[50dvh] rounded-lg" playsinline muted></video>
			{:else if lastResult}
				<div class="p-6 text-center text-sm text-[oklch(0.65_0.015_55)]">
					<p>{m.record_done({ name: lastResult.fileName })}</p>
					<a
						class="mt-2 inline-block underline"
						href={lastResult.url}
						download={lastResult.fileName}
					>
						{m.record_download_again()}
					</a>
				</div>
			{:else}
				<p class="text-sm text-[oklch(0.65_0.015_55)]">{m.record_preview_empty()}</p>
			{/if}
		</section>

		{#if !session.recording}
			<fieldset class="flex flex-wrap items-center justify-center gap-2">
				<legend class="sr-only">{m.record_source_label()}</legend>
				{#each ['screen', 'camera', 'screen-camera', 'audio'] as const as option (option)}
					<Button
						size="sm"
						variant={source === option ? 'default' : 'outline'}
						aria-pressed={source === option}
						onclick={() => (source = option)}
					>
						{option === 'screen'
							? m.record_source_screen()
							: option === 'camera'
								? m.record_source_camera()
								: option === 'screen-camera'
									? m.record_source_both()
									: m.record_source_audio()}
					</Button>
				{/each}
			</fieldset>

			<div class="flex flex-wrap items-center justify-center gap-3 text-sm">
				{#if needsCamera && cameras.length > 0}
					<label class="flex items-center gap-1.5">
						{m.record_camera()}
						<select bind:value={cameraId} class="rounded-md bg-[oklch(0.18_0.008_55)] px-2 py-1">
							{#each cameras as camera (camera.deviceId)}
								<option value={camera.deviceId}>{camera.label || m.record_device_default()}</option>
							{/each}
						</select>
					</label>
				{/if}
				{#if source !== 'screen' && microphones.length > 0}
					<label class="flex items-center gap-1.5">
						{m.record_microphone()}
						<select bind:value={micId} class="rounded-md bg-[oklch(0.18_0.008_55)] px-2 py-1">
							<option value="">{m.record_device_default()}</option>
							{#each microphones as mic (mic.deviceId)}
								<option value={mic.deviceId}>{mic.label}</option>
							{/each}
						</select>
					</label>
				{/if}
				{#if hasVideo}
					<label class="flex items-center gap-1.5">
						<input
							type="checkbox"
							bind:checked={systemAudio}
							class="accent-[oklch(0.66_0.14_45)]"
						/>
						{m.record_system_audio()}
					</label>
				{/if}
			</div>

			<Button class="mx-auto" onclick={start}>{m.record_start()}</Button>
		{:else}
			<div class="flex flex-col items-center gap-2">
				<span class="font-mono text-lg tabular-nums" aria-live="polite">
					● {Math.floor(session.elapsedSeconds / 60)}:{String(session.elapsedSeconds % 60).padStart(
						2,
						'0'
					)}
				</span>
				<Button variant="destructive" onclick={stopAndSave}>{m.record_stop_save()}</Button>
			</div>
		{/if}

		{#if !recorderMimeType(hasVideo)}
			<p class="text-center text-xs text-red-400">{m.record_unsupported()}</p>
		{/if}
	</main>
</div>
