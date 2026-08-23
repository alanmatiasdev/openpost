// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneAnalysis } from '../media/scene-search/types';
import type { MediaMetadata } from '../media/types';

const storage = vi.hoisted(() => ({
	document: null as unknown,
	buffers: new Map<string, ArrayBuffer>(),
	writeJsonAtomic: vi.fn(),
	writeBlob: vi.fn(),
	removeEntry: vi.fn()
}));

vi.mock('./root', () => ({ requireWorkspaceRoot: () => ({ name: 'test' }) }));
vi.mock('./fs-primitives', () => ({
	readJson: vi.fn(async () => storage.document),
	readArrayBuffer: vi.fn(
		async (_root: unknown, path: string[]) => storage.buffers.get(path.join('/')) ?? null
	),
	readBlob: vi.fn(),
	writeJsonAtomic: storage.writeJsonAtomic,
	writeBlob: storage.writeBlob,
	removeEntry: storage.removeEntry
}));

import { getSceneAnalysis, saveSceneAnalysis, sceneAnalysisMatchesMedia } from './scene-analysis';

const analysis: SceneAnalysis = {
	schemaVersion: 1,
	detectorVersion: 2,
	mediaId: 'media-1',
	contentHash: 'sha256',
	sourceFileSize: 123,
	sourceLastModified: 456,
	method: 'adaptive',
	sampleIntervalSec: 0,
	analyzedAt: 1000,
	scenes: [
		{
			id: 'media-1:0',
			mediaId: 'media-1',
			index: 0,
			startSec: 0,
			endSec: 2,
			timeSec: 0.2,
			text: 'Kitchen counter',
			embedding: Float32Array.from([1, 0]),
			imageEmbedding: Float32Array.from([0, 1, 0])
		},
		{
			id: 'media-1:1',
			mediaId: 'media-1',
			index: 1,
			startSec: 2,
			endSec: 4,
			timeSec: 2.2,
			text: 'Window light'
		}
	]
};

beforeEach(() => {
	storage.document = null;
	storage.buffers.clear();
	storage.writeJsonAtomic.mockReset().mockImplementation(async (_root, _path, value) => {
		storage.document = value;
	});
	storage.writeBlob.mockReset().mockImplementation(async (_root, path, bytes: Uint8Array) => {
		storage.buffers.set(path.join('/'), bytes.slice().buffer);
	});
	storage.removeEntry.mockReset();
});

describe('scene analysis persistence', () => {
	it('stores vectors as packed binary data and hydrates them by scene index', async () => {
		await saveSceneAnalysis(analysis);
		expect(storage.writeJsonAtomic).toHaveBeenCalledTimes(1);
		expect(storage.writeBlob).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(storage.document)).not.toContain('embedding');

		const restored = await getSceneAnalysis('media-1');
		expect(restored?.scenes[0]?.embedding).toEqual(Float32Array.from([1, 0]));
		expect(restored?.scenes[0]?.imageEmbedding).toEqual(Float32Array.from([0, 1, 0]));
		expect(restored?.scenes[1]?.embedding).toBeUndefined();
	});

	it('invalidates cache entries when source identity changes', () => {
		const media = {
			id: 'media-1',
			fileSize: 123,
			fileLastModified: 456,
			contentHash: 'sha256'
		} as MediaMetadata;
		expect(sceneAnalysisMatchesMedia(analysis, media)).toBe(true);
		expect(sceneAnalysisMatchesMedia(analysis, { ...media, contentHash: 'other' })).toBe(false);
		expect(sceneAnalysisMatchesMedia(analysis, { ...media, fileSize: 124 })).toBe(false);
	});
});
