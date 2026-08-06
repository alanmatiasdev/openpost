<script lang="ts">
	import { untrack } from 'svelte';
	import Uppy from '@uppy/core';
	import Webcam from '@uppy/webcam';
	import ImageEditor from '@uppy/image-editor';
	import Dashboard from '@uppy/svelte/dashboard';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import StockMediaBrowser from '$lib/components/stock-media-browser.svelte';
	import VideoEditorDialog from '$lib/components/video-editor-dialog.svelte';
	import { uploadMediaFile, type MediaUploadResult } from '$lib/media-upload-client';
	import { videoPreparationErrorMessage } from '$lib/video/errors';
	import type {
		VideoConstraint,
		VideoPreparationProgress,
		VideoPreparationStage
	} from '$lib/video/types';
	import type { StockAsset } from '$lib/video-editor/api';
	import type { StockMediaProvenance } from '@openpost/video-project';
	import UploadIcon from 'lucide-svelte/icons/upload';
	import ImageIcon from 'lucide-svelte/icons/image';
	import LibraryIcon from 'lucide-svelte/icons/library';
	import { m } from '$lib/paraglide/messages';
	import '@uppy/core/css/style.min.css';
	import '@uppy/dashboard/css/style.min.css';
	import '@uppy/webcam/css/style.min.css';
	import '@uppy/image-editor/css/style.min.css';
	import '@uppy/svelte/css/style.css';
	import '@uppy/svelte/css/image-editor.css';

	type SourceMode = 'upload' | 'stock';

	let {
		open = $bindable(false),
		workspaceId,
		accept = ['image/*', 'video/*', 'audio/*'],
		maxFiles = 10,
		retentionClass = 'library',
		tagId,
		videoConstraints = [],
		initialSource = 'upload',
		initialFiles = [],
		showLibrary = false,
		onOpenLibrary,
		onInitialFilesConsumed,
		onUploaded
	}: {
		open?: boolean;
		workspaceId: string;
		accept?: string[];
		maxFiles?: number;
		retentionClass?: 'library' | 'temporary';
		tagId?: string;
		videoConstraints?: VideoConstraint[];
		initialSource?: SourceMode;
		initialFiles?: File[];
		showLibrary?: boolean;
		onOpenLibrary?: () => void;
		onInitialFilesConsumed?: () => void;
		onUploaded: (results: MediaUploadResult[]) => void | Promise<void>;
	} = $props();

	let source = $state<SourceMode>('upload');
	let busy = $state(false);
	let error = $state('');
	let progress = $state.raw<VideoPreparationProgress | null>(null);
	let uploadController: AbortController | null = null;
	let videoEditorOpen = $state(false);
	let videoEditorFile = $state.raw<File | null>(null);
	let resolveVideoEdit: ((file: File | null) => void) | null = null;
	let uploadCancelled = false;

	const allowedVideoAspectRatios = $derived(
		videoConstraints.flatMap((constraint) => constraint.aspect_ratios ?? [])
	);

	const uppy = new Uppy<Record<string, unknown>, { id?: string }>({
		autoProceed: false
	})
		.use(Webcam, {
			modes: ['picture'],
			mirror: true
		})
		.use(ImageEditor, {
			actions: {
				cropSquare: true,
				cropWidescreen: true,
				cropWidescreenVertical: true,
				rotate: true,
				zoomIn: true,
				zoomOut: true
			}
		});

	uppy.addUploader(uploadWithUppy);
	uppy.on('restriction-failed', (_file, cause) => {
		error = cause.message || m.media_picker_upload_failed();
	});

	function initialize(): void {
		untrack(() => {
			source = initialSource;
			error = '';
			progress = null;
			uppy.cancelAll();
			for (const file of initialFiles) {
				try {
					uppy.addFile({ name: file.name, type: file.type, data: file });
				} catch (cause) {
					error = cause instanceof Error ? cause.message : m.media_picker_upload_failed();
				}
			}
			if (initialFiles.length > 0) onInitialFilesConsumed?.();
		});
	}

	$effect(() => {
		uppy.setOptions({
			restrictions: {
				...uppy.opts.restrictions,
				maxNumberOfFiles: maxFiles,
				allowedFileTypes: accept
			}
		});
	});

	$effect(() => {
		return () => {
			uploadController?.abort();
			uppy.destroy();
		};
	});

	function accepts(type: 'image' | 'video'): boolean {
		return accept.some((candidate) =>
			candidate.endsWith('/*') ? candidate.startsWith(`${type}/`) : candidate.startsWith(`${type}/`)
		);
	}

	function stockProvenance(asset: StockAsset): StockMediaProvenance {
		return {
			provider: asset.provider,
			external_id: asset.external_id,
			source_url: asset.source_url,
			creator_name: asset.creator_name,
			creator_url: asset.creator_url,
			license_name: asset.license_name,
			license_url: asset.license_url,
			attribution_text: asset.attribution_text
		};
	}

	async function uploadFiles(
		files: File[],
		options: { source?: 'upload' | 'stock_import'; provenance?: StockMediaProvenance } = {}
	): Promise<MediaUploadResult[]> {
		if (!workspaceId || files.length === 0) return [];
		busy = true;
		error = '';
		uploadCancelled = false;
		uploadController = new AbortController();
		const results: MediaUploadResult[] = [];
		try {
			for (const [index, file] of files.entries()) {
				const uploadFile = isVideoFile(file) ? await requestVideoEdit(file) : file;
				if (!uploadFile) {
					uploadCancelled = true;
					return [];
				}
				const result = await uploadMediaFile({
					workspaceId,
					file: uploadFile,
					source: options.source ?? 'upload',
					retentionClass,
					tagId,
					stockProvenance: options.provenance,
					videoConstraints,
					signal: uploadController.signal,
					onProgress: (next) => {
						progress = {
							...next,
							fraction: Math.min(1, (index + next.fraction) / files.length)
						};
					}
				});
				results.push(result);
			}
			await onUploaded(results);
			open = false;
			return results;
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === 'AbortError') {
				error = '';
				return [];
			}
			error = videoPreparationErrorMessage(cause, m.media_picker_upload_failed());
			return [];
		} finally {
			busy = false;
			progress = null;
			uploadController = null;
		}
	}

	function isVideoFile(file: File): boolean {
		return file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name);
	}

	function requestVideoEdit(file: File): Promise<File | null> {
		videoEditorFile = file;
		videoEditorOpen = true;
		return new Promise((resolve) => {
			resolveVideoEdit = resolve;
		});
	}

	function completeVideoEdit(file: File | null): void {
		videoEditorOpen = false;
		videoEditorFile = null;
		const resolve = resolveVideoEdit;
		resolveVideoEdit = null;
		resolve?.(file);
	}

	async function uploadWithUppy(fileIDs: string[]): Promise<void> {
		const files = fileIDs.flatMap((id) => {
			const candidate = uppy.getFile(id);
			if (!(candidate.data instanceof Blob)) return [];
			return [
				candidate.data instanceof File
					? candidate.data
					: new File([candidate.data], candidate.name, {
							type: candidate.type || 'application/octet-stream'
						})
			];
		});
		const results = await uploadFiles(files);
		if (uploadCancelled) {
			uppy.cancelAll();
			return;
		}
		if (results.length !== files.length) {
			const cause = new Error(error || m.media_picker_upload_failed());
			for (const id of fileIDs) uppy.emit('upload-error', uppy.getFile(id), cause);
			throw cause;
		}
		for (const [index, id] of fileIDs.entries()) {
			uppy.emit('upload-success', uppy.getFile(id), {
				status: 200,
				body: { id: results[index]?.id },
				uploadURL: undefined
			});
		}
	}

	async function addStockMedia(file: File, asset: StockAsset): Promise<void> {
		await uploadFiles([file], {
			source: 'stock_import',
			provenance: stockProvenance(asset)
		});
	}

	function openLibrary(): void {
		open = false;
		onOpenLibrary?.();
	}

	function cancelUpload(): void {
		uploadCancelled = true;
		uploadController?.abort();
	}

	function uploadStage(stage: VideoPreparationStage): string {
		switch (stage) {
			case 'inspecting':
				return m.video_upload_inspecting();
			case 'remuxing':
				return m.video_upload_remuxing();
			case 'compressing':
				return m.video_upload_compressing();
			case 'uploading':
				return m.video_upload_uploading();
			case 'finalizing':
				return m.video_upload_finalizing();
			case 'processing':
				return m.video_upload_processing();
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="top-0 left-0 flex h-dvh max-h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:top-1/2 sm:left-1/2 sm:h-[min(680px,calc(100dvh-2rem))] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
		showCloseButton={!busy}
		onInteractOutside={(event) => busy && event.preventDefault()}
		onEscapeKeydown={(event) => busy && event.preventDefault()}
	>
		<div class="contents" {@attach initialize}></div>
		<Dialog.Header class="shrink-0 border-b px-5 py-4 pr-14">
			<Dialog.Title>{m.media_upload_title()}</Dialog.Title>
			<Dialog.Description>{m.media_upload_description()}</Dialog.Description>
		</Dialog.Header>

		<div
			class="flex shrink-0 gap-1 overflow-x-auto border-b px-4 py-2"
			aria-label={m.media_source()}
		>
			<Button
				variant={source === 'upload' ? 'secondary' : 'ghost'}
				size="sm"
				class="shrink-0"
				onclick={() => (source = 'upload')}
			>
				<UploadIcon />
				{m.image_editor_upload_camera()}
			</Button>
			<Button
				variant={source === 'stock' ? 'secondary' : 'ghost'}
				size="sm"
				class="shrink-0"
				onclick={() => (source = 'stock')}
			>
				<ImageIcon />
				{m.video_editor_stock()}
			</Button>
			{#if showLibrary}
				<Button variant="ghost" size="sm" class="shrink-0" onclick={openLibrary}>
					<LibraryIcon />
					{m.media_picker_library()}
				</Button>
			{/if}
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
			{#if source === 'upload'}
				<div class="openpost-uppy overflow-hidden rounded-xl">
					<Dashboard
						{uppy}
						plugins={['Webcam', 'ImageEditor']}
						props={{
							inline: true,
							height: 440,
							width: '100%',
							proudlyDisplayPoweredByUppy: false,
							hideProgressDetails: false,
							note: m.media_upload_batch_hint()
						}}
					/>
				</div>
			{:else}
				<StockMediaBrowser
					accept={accepts('image') && accepts('video')
						? 'both'
						: accepts('video')
							? 'video'
							: 'photo'}
					onSelect={addStockMedia}
				/>
			{/if}
		</div>

		{#if error}
			<div class="shrink-0 px-4 pb-3 sm:px-5">
				<InlineNotice
					tone="error"
					message={error}
					dismissLabel={m.common_dismiss()}
					onDismiss={() => (error = '')}
				/>
			</div>
		{/if}
		{#if progress}
			<div class="shrink-0 border-t px-4 py-3 sm:px-5" aria-live="polite">
				<div class="flex items-center justify-between gap-3">
					<p class="text-sm font-medium">
						{m.video_upload_progress({
							stage: uploadStage(progress.stage),
							percent: Math.round(progress.fraction * 100)
						})}
					</p>
					<Button type="button" variant="ghost" size="sm" onclick={cancelUpload}>
						{m.video_upload_cancel()}
					</Button>
				</div>
				<div class="mt-2 h-2 overflow-hidden rounded-full bg-muted">
					<div
						class="h-full rounded-full bg-primary transition-[width]"
						style:width={`${Math.round(progress.fraction * 100)}%`}
					></div>
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<VideoEditorDialog
	bind:open={videoEditorOpen}
	file={videoEditorFile}
	allowedAspectRatios={allowedVideoAspectRatios}
	onConfirm={(file) => completeVideoEdit(file)}
	onSkip={(file) => completeVideoEdit(file)}
	onCancel={() => completeVideoEdit(null)}
/>
