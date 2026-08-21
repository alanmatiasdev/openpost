/**
 * Media metadata types for the workspace media pool.
 *
 * Ported from FreeCut (MIT) — types/storage.ts, trimmed to v1.
 */

/**
 * How the media file is stored:
 * - 'handle':    references the user's original file on disk (linked source)
 * - 'workspace': source bytes copied into the workspace folder (collected source)
 */
export type MediaStorageType = 'handle' | 'workspace';

export interface MediaMetadata {
	id: string;
	storageType: MediaStorageType;
	/**
	 * FileSystemFileHandle for direct disk access (when storageType === 'handle').
	 * Stored in IndexedDB — requires permission re-request on new sessions.
	 * Non-serializable; stripped on save and re-attached on load.
	 */
	fileHandle?: FileSystemFileHandle;
	contentHash?: string;
	fileLastModified?: number;
	fileName: string;
	fileSize: number;
	mimeType: string;
	duration: number;
	width: number;
	height: number;
	fps: number;
	codec: string;
	bitrate: number;
	audioCodec?: string;
	audioCodecSupported?: boolean;
	videoCodecSupported?: boolean;
	previewAudioConformedAt?: number;
	/**
	 * Sorted keyframe timestamps in seconds, extracted at import time via
	 * mediabunny EncodedPacketSink. Used for adaptive seek backtracking.
	 */
	keyframeTimestamps?: number[];
	gopInterval?: number;
	tags: string[];
}
