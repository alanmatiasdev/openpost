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
import { readBlob, writeBlob, writeJsonAtomic } from '../workspace-fs/fs-primitives';
import {
	mediaMetadataPath,
	mediaSourceByFileName,
	mediaThumbnailPath,
	sanitizeWorkspaceFileName
} from '../workspace-fs/paths';
import { associateMediaWithProject } from '../workspace-fs/project-media';
import { createMedia } from '../workspace-fs/media';
import type { MediaMetadata } from './types';
import { probeMediaFile } from './probe-client';
import { mediaPool } from './pool.svelte';

const logger = createLogger('MediaImport');

export interface ImportOptions {
	projectId: string;
	/** 'copy' collects bytes into the workspace; 'link' references in place. */
	storageMode: 'copy' | 'link';
}

const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|aac|ogg|opus|flac)$/i;

function guessKind(file: File): 'video' | 'audio' | 'image' {
	if (file.type.startsWith('video/')) return 'video';
	if (file.type.startsWith('audio/')) return 'audio';
	if (file.type.startsWith('image/')) return 'image';
	if (AUDIO_EXTENSIONS.test(file.name)) return 'audio';
	return 'video';
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
	const kind = 'kind' in handle && handle.kind === 'file' ? undefined : undefined;

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
		let file: File;
		let fileLastModified: number | undefined;
		let storedHandle: FileSystemFileHandle | undefined;

		if ('getFile' in handle) {
			// SAFETY: getFile in handle implies FileSystemFileHandle.
			const fileHandle = handle as FileSystemFileHandle;
			const resolved = await writeFileForHandle(fileHandle);
			file = resolved.file;
			fileLastModified = resolved.lastModified;
			storedHandle = storageMode === 'link' ? fileHandle : undefined;
		} else {
			throw new Error('Unsupported handle');
		}
		void kind;

		const probe = await probeMediaFile(file);
		const metadata: MediaMetadata = {
			id,
			storageType: storageMode === 'copy' ? 'workspace' : 'handle',
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
			tags: [probe.kind]
		};

		if (storageMode === 'copy') {
			await writeBlob(root, mediaSourceByFileName(id, file.name), file);
		}

		await createMedia(metadata);
		if (probe.thumbnailBlob) {
			await writeBlob(root, mediaThumbnailPath(id), probe.thumbnailBlob);
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

/** Resolve the playable blob for a media item (linked or collected). */
export async function resolveMediaBlob(media: MediaMetadata): Promise<Blob> {
	const root = requireWorkspaceRoot();
	if (media.storageType === 'handle' && media.fileHandle) {
		try {
			return await media.fileHandle.getFile();
		} catch {
			// Fall through to the mirrored workspace copy below.
		}
	}
	const blob = await readBlob(root, mediaSourceByFileName(media.id, sanitizeOrName(media)));
	if (!blob) throw new Error(`Source bytes missing for ${media.fileName}`);
	return blob;
}

function sanitizeOrName(media: MediaMetadata): string {
	return sanitizeWorkspaceFileName(media.fileName);
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
					'image/*': ['.png', '.jpg', '.jpeg', '.webp']
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
