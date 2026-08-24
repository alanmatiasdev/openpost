import { readBlob } from '../workspace-fs/fs-primitives';
import { mediaSourceByFileName, sanitizeWorkspaceFileName } from '../workspace-fs/paths';
import { requireWorkspaceRoot } from '../workspace-fs/root';
import type { MediaMetadata } from './types';

/** Resolve a linked or collected source without loading media-import UI code. */
export async function resolveMediaBlob(media: MediaMetadata): Promise<Blob> {
	const root = requireWorkspaceRoot();
	if (media.storageType === 'handle' && media.fileHandle) {
		try {
			return await media.fileHandle.getFile();
		} catch {
			// Fall through to the mirrored workspace copy below.
		}
	}
	const fileName = sanitizeWorkspaceFileName(media.fileName);
	const blob = await readBlob(root, mediaSourceByFileName(media.id, fileName));
	if (!blob) throw new Error(`Source bytes missing for ${media.fileName}`);
	return blob;
}
