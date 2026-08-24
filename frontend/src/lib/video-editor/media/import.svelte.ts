/**
 * Import orchestration: file picker/drop → probe → workspace record.
 *
 * Copy mode writes source bytes into `media/{id}/{sanitizedName}` (collected
 * source). Link mode stashes the FileSystemFileHandle in the handles
 * registry (linked source) and mirrors nothing. Thumbnails land at
 * `media/{id}/thumbnail.jpg`. Records join the pool store optimistically.
 *
 * Adapted from FreeCut (MIT) media-library import, trimmed to v1.
 */

import { createLogger } from '../workspace-fs/logger';
import { requireWorkspaceRoot } from '../workspace-fs/root';
import { writeBlob, writeJsonAtomic } from '../workspace-fs/fs-primitives';
import {
	mediaMetadataPath,
	mediaSourceByFileName,
	mediaThumbnailPath,
	sanitizeWorkspaceFileName
} from '../workspace-fs/paths';
import { associateMediaWithProject, removeMediaFromProject } from '../workspace-fs/project-media';
import { createMedia, deleteMedia } from '../workspace-fs/media';
import type { MediaAttribution, MediaMetadata } from './types';
import { probeMediaFile } from './probe-client';
import { mediaPool } from './pool.svelte';
import { isLottieFile, parseLottieFileBytes } from '../lottie/metadata';
import { effectiveMediaStorageMode, prepareMediaImportFile } from './media-file-types';

const logger = createLogger('MediaImport');

/** Remove a newly created generated asset that has not been exposed outside this project. */
export async function rollbackNewGeneratedMedia(projectId: string, mediaId: string): Promise<void> {
	mediaPool.remove(mediaId);
	await removeMediaFromProject(projectId, mediaId).catch((error) => {
		logger.warn(`Could not remove generated media ${mediaId} from the project`, error);
	});
	await deleteMedia(mediaId).catch((error) => {
		logger.warn(`Could not remove generated media ${mediaId} from workspace storage`, error);
	});
}

export interface ImportOptions {
	projectId: string;
	/** 'copy' collects bytes into the workspace; 'link' references in place. */
	storageMode: 'copy' | 'link';
	attribution?: MediaAttribution;
}

export interface GeneratedImageImportOptions {
	projectId: string;
	width: number;
	height: number;
	tags?: string[];
}

export interface GeneratedAudioImportOptions {
	projectId: string;
	duration: number;
	tags?: string[];
}

async function writeFileForHandle(
	handle: FileSystemFileHandle
): Promise<{ file: File; lastModified: number }> {
	const file = await handle.getFile();
	return { file, lastModified: file.lastModified };
}

/**
 * Import one dropped/picked handle into the project and pool.
 * Resolves with the media id; pool entry transitions importing → ready/failed.
 */
export async function importFile(
	handle: FileSystemFileHandle,
	options: ImportOptions
): Promise<string> {
	const root = requireWorkspaceRoot();
	const id = crypto.randomUUID();
	const { storageMode, projectId } = options;

	mediaPool.upsert(
		{
			id,
			storageType: storageMode === 'copy' ? 'workspace' : 'handle',
			fileName: handle.name,
			fileSize: 0,
			mimeType: '',
			duration: 0,
			width: 0,
			height: 0,
			fps: 0,
			codec: '',
			bitrate: 0,
			tags: []
		},
		'importing',
		0
	);

	try {
		const resolved = await writeFileForHandle(handle);
		const file = await prepareMediaImportFile(resolved.file);
		const fileLastModified = resolved.lastModified;
		const effectiveStorageMode = effectiveMediaStorageMode(storageMode, resolved.file, file);
		const storedHandle = effectiveStorageMode === 'link' ? handle : undefined;

		let thumbnailBlob: Blob | undefined;
		let metadata: MediaMetadata;
		if (isLottieFile(file)) {
			const lottie = parseLottieFileBytes(new Uint8Array(await file.arrayBuffer()));
			if (!lottie) throw new Error('This file is not a valid Lottie animation.');
			metadata = {
				id,
				storageType: effectiveStorageMode === 'copy' ? 'workspace' : 'handle',
				fileHandle: storedHandle,
				fileLastModified,
				fileName: file.name,
				fileSize: file.size,
				mimeType:
					file.type || (/\.lottie$/i.test(file.name) ? 'application/zip' : 'application/json'),
				duration: lottie.durationSeconds,
				width: lottie.width,
				height: lottie.height,
				fps: lottie.frameRate,
				codec: 'lottie',
				bitrate: Math.round((file.size * 8) / Math.max(lottie.durationSeconds, 1)),
				lottieTotalFrames: lottie.totalFrames,
				lottieMarkers: lottie.markers,
				attribution: options.attribution,
				tags: ['lottie']
			};
			const { renderLottieThumbnail } = await import('../lottie/frame-provider');
			thumbnailBlob =
				(await renderLottieThumbnail(file, lottie.width, lottie.height, lottie.totalFrames)) ??
				undefined;
		} else {
			const probe = await probeMediaFile(file);
			metadata = {
				id,
				storageType: effectiveStorageMode === 'copy' ? 'workspace' : 'handle',
				fileHandle: storedHandle,
				fileLastModified,
				fileName: file.name,
				fileSize: file.size,
				mimeType: file.type || 'application/octet-stream',
				duration: probe.durationSeconds,
				width: probe.width,
				height: probe.height,
				fps: probe.fps,
				codec: probe.videoCodec ?? '',
				bitrate: Math.round((file.size * 8) / Math.max(probe.durationSeconds, 1)),
				audioCodec: probe.audioCodec,
				keyframeTimestamps: probe.keyframeTimestamps,
				gopInterval: probe.gopInterval,
				attribution: options.attribution,
				tags: [probe.kind]
			};
			thumbnailBlob = probe.thumbnailBlob;
		}

		if (effectiveStorageMode === 'copy') {
			await writeBlob(root, mediaSourceByFileName(id, file.name), file);
		}

		await createMedia(metadata);
		if (thumbnailBlob) {
			await writeBlob(root, mediaThumbnailPath(id), thumbnailBlob);
		}
		await writeJsonAtomic(root, mediaMetadataPath(id), {
			...metadata,
			fileHandle: undefined
		});
		await associateMediaWithProject(projectId, id);

		mediaPool.upsert({ ...metadata, fileHandle: storedHandle }, 'ready');
		return id;
	} catch (error) {
		logger.error(`importFile(${handle.name}) failed`, error);
		mediaPool.setStatus(id, 'failed', error instanceof Error ? error.message : String(error));
		throw error;
	}
}

const MAX_REMOTE_LOTTIE_BYTES = 20 * 1024 * 1024;

/** Download one public LottieFiles animation into the local workspace. */
export async function importRemoteLottie(options: {
	projectId: string;
	url: string;
	fileName: string;
	attribution: MediaAttribution;
}): Promise<string> {
	const source = new URL(options.url);
	if (source.protocol !== 'https:' || source.hostname !== 'assets-v2.lottiefiles.com') {
		throw new Error('The animation source is not a trusted LottieFiles asset.');
	}
	const response = await fetch(source, {
		credentials: 'omit',
		referrerPolicy: 'no-referrer'
	});
	if (!response.ok) throw new Error(`Animation download failed (${response.status}).`);
	const declaredSize = Number(response.headers.get('content-length') ?? 0);
	if (declaredSize > MAX_REMOTE_LOTTIE_BYTES) {
		throw new Error('The animation is larger than the 20 MB import limit.');
	}
	const blob = await response.blob();
	if (blob.size > MAX_REMOTE_LOTTIE_BYTES) {
		throw new Error('The animation is larger than the 20 MB import limit.');
	}
	const baseName = sanitizeWorkspaceFileName(options.fileName).replace(/\.(?:json|lottie)$/i, '');
	const file = new File([blob], `${baseName || 'lottiefiles-animation'}.lottie`, {
		type: 'application/zip',
		lastModified: Date.now()
	});
	// SAFETY: importFile only reads name, kind, and getFile from this copy-only handle.
	const handle = {
		name: file.name,
		kind: 'file',
		getFile: async () => file
	} as FileSystemFileHandle;
	return importFile(handle, {
		projectId: options.projectId,
		storageMode: 'copy',
		attribution: options.attribution
	});
}

export { resolveMediaBlob } from './resolve-media-blob';

/** Save a renderer-created image into the workspace media pool. */
export async function importGeneratedImage(
	file: File,
	options: GeneratedImageImportOptions
): Promise<MediaMetadata> {
	const root = requireWorkspaceRoot();
	const id = crypto.randomUUID();
	const fileName = sanitizeWorkspaceFileName(file.name);
	const metadata: MediaMetadata = {
		id,
		storageType: 'workspace',
		fileName,
		fileSize: file.size,
		mimeType: file.type || 'image/png',
		duration: 0,
		width: options.width,
		height: options.height,
		fps: 0,
		codec: 'png',
		bitrate: 0,
		tags: [...new Set(['image', ...(options.tags ?? [])])]
	};

	try {
		await writeBlob(root, mediaSourceByFileName(id, fileName), file);
		await createMedia(metadata);
		await associateMediaWithProject(options.projectId, id);
		mediaPool.upsert(metadata, 'ready');
		return metadata;
	} catch (error) {
		await rollbackNewGeneratedMedia(options.projectId, id);
		throw error;
	}
}

/** Save locally generated speech or music into the workspace media pool. */
export async function importGeneratedAudio(
	file: File,
	options: GeneratedAudioImportOptions
): Promise<MediaMetadata> {
	const root = requireWorkspaceRoot();
	const id = crypto.randomUUID();
	const fileName = sanitizeWorkspaceFileName(file.name);
	const duration = Math.max(0, options.duration);
	const metadata: MediaMetadata = {
		id,
		storageType: 'workspace',
		fileName,
		fileSize: file.size,
		mimeType: file.type || 'audio/wav',
		duration,
		width: 0,
		height: 0,
		fps: 0,
		codec: '',
		bitrate: duration > 0 ? Math.round((file.size * 8) / duration) : 0,
		audioCodec: file.type === 'audio/wav' ? 'pcm_f32le' : undefined,
		audioCodecSupported: true,
		tags: [...new Set(['audio', 'ai-generated', ...(options.tags ?? [])])]
	};

	try {
		await writeBlob(root, mediaSourceByFileName(id, fileName), file);
		await createMedia(metadata);
		await associateMediaWithProject(options.projectId, id);
		mediaPool.upsert(metadata, 'ready');
		return metadata;
	} catch (error) {
		await rollbackNewGeneratedMedia(options.projectId, id);
		throw error;
	}
}

/** Open the platform file picker and import every selection. */
export async function importFromPicker(options: ImportOptions): Promise<string[]> {
	const handles = await window.showOpenFilePicker?.({
		multiple: true,
		types: [
			{
				description: 'Media',
				accept: {
					'video/*': ['.mp4', '.webm', '.mov', '.mkv', '.m4v'],
					'audio/*': ['.mp3', '.wav', '.m4a', '.aac', '.ogg'],
					'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'],
					'application/json': ['.json'],
					'application/zip': ['.lottie']
				}
			}
		]
	});
	if (!handles || handles.length === 0) return [];
	const ids: string[] = [];
	for (const handle of handles) {
		try {
			ids.push(await importFile(handle, options));
		} catch {
			// Per-file failure already surfaced via pool status; keep going.
		}
	}
	return ids;
}
