import { afterEach, describe, expect, it } from 'vitest';
import { readBlob, readJson } from '../workspace-fs/fs-primitives';
import {
	mediaMetadataPath,
	mediaSourceByFileName,
	mediaThumbnailPath
} from '../workspace-fs/paths';
import { setWorkspaceRoot } from '../workspace-fs/root';
import { importGeneratedImage } from './import.svelte';
import { mediaPool } from './pool.svelte';
import type { MediaMetadata } from './types';

let workspaceName: string | null = null;

async function generatedPng(width = 640, height = 360, type = 'image/png'): Promise<File> {
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable.');
	context.fillStyle = '#d44a33';
	context.fillRect(0, 0, width, height);
	context.fillStyle = '#ffffff';
	context.fillRect(width / 4, height / 4, width / 2, height / 2);
	const blob = await canvas.convertToBlob({ type: 'image/png' });
	return new File([blob], 'generated frame.png', { type });
}

afterEach(async () => {
	mediaPool.clear();
	setWorkspaceRoot(null);
	if (workspaceName) {
		const root = await navigator.storage.getDirectory();
		await root.removeEntry(workspaceName, { recursive: true }).catch(() => undefined);
		workspaceName = null;
	}
});

describe('generated image import', () => {
	it('decodes, thumbnails, persists, associates, and exposes a rendered still as first-class media', async () => {
		const root = await navigator.storage.getDirectory();
		workspaceName = `generated-image-test-${crypto.randomUUID()}`;
		const workspace = await root.getDirectoryHandle(workspaceName, { create: true });
		setWorkspaceRoot(workspace);
		const file = await generatedPng(640, 360, '');

		const imported = await importGeneratedImage(file, {
			projectId: 'project',
			width: 640,
			height: 360,
			tags: ['frame-capture']
		});

		expect(imported).toMatchObject({
			storageType: 'workspace',
			fileName: 'generated frame.png',
			mimeType: 'image/png',
			width: 640,
			height: 360,
			codec: 'png'
		});
		expect(imported.tags).toEqual(expect.arrayContaining(['image', 'frame-capture']));
		expect(mediaPool.get(imported.id)).toEqual(imported);
		expect(
			await readBlob(workspace, mediaSourceByFileName(imported.id, imported.fileName))
		).not.toBeNull();
		expect(await readJson<MediaMetadata>(workspace, mediaMetadataPath(imported.id))).toEqual(
			imported
		);

		const thumbnail = await readBlob(workspace, mediaThumbnailPath(imported.id));
		expect(thumbnail?.type).toBe('image/jpeg');
		if (!thumbnail) throw new Error('Expected a persisted thumbnail.');
		const bitmap = await createImageBitmap(thumbnail);
		try {
			expect({ width: bitmap.width, height: bitmap.height }).toEqual({ width: 320, height: 180 });
		} finally {
			bitmap.close();
		}
	});

	it('rejects mislabeled dimensions before writing an inconsistent media record', async () => {
		const root = await navigator.storage.getDirectory();
		workspaceName = `generated-image-test-${crypto.randomUUID()}`;
		const workspace = await root.getDirectoryHandle(workspaceName, { create: true });
		setWorkspaceRoot(workspace);

		await expect(
			importGeneratedImage(await generatedPng(64, 36), {
				projectId: 'project',
				width: 1920,
				height: 1080
			})
		).rejects.toThrow('do not match its pixels (64x36)');
		expect(mediaPool.mediaList).toHaveLength(0);
	});
});
