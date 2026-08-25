import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readBlob, readJson } from '../workspace-fs/fs-primitives';
import { mediaMetadataPath, mediaSourceByFileName } from '../workspace-fs/paths';
import { setWorkspaceRoot } from '../workspace-fs/root';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import {
	fluentEmojiAttribution,
	fluentEmojiStickerFile,
	parseFluentEmojiCatalog
} from '../stickers/fluent-emoji';
import { commitImportedAsset } from './commit-imported-asset';
import { mediaPool } from './pool.svelte';
import type { MediaMetadata } from './types';

let workspaceName: string | null = null;
const sticker = parseFluentEmojiCatalog({
	prefix: 'fluent-emoji-flat',
	width: 32,
	height: 32,
	icons: {
		'party-popper': {
			body: '<g fill="none"><path fill="#f97316" d="M2 30 16 2l14 14z"/><circle fill="#fff" cx="16" cy="12" r="3"/></g>'
		}
	}
}).byName.get('party-popper')!;

beforeEach(() => {
	mediaPool.clear();
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore.setAll({
		fps: 30,
		currentFrame: 0,
		tracks: [
			{
				id: 'video',
				name: 'Video',
				kind: 'video',
				height: 96,
				locked: false,
				visible: true,
				muted: false,
				solo: false,
				order: 0
			}
		],
		items: []
	});
});

afterEach(async () => {
	mediaPool.clear();
	setWorkspaceRoot(null);
	if (workspaceName) {
		const root = await navigator.storage.getDirectory();
		await root.removeEntry(workspaceName, { recursive: true }).catch(() => undefined);
		workspaceName = null;
	}
});

describe('commitImportedAsset', () => {
	it('sanitizes, rasterizes, persists, credits, inserts, and reuses a sticker source', async () => {
		const root = await navigator.storage.getDirectory();
		workspaceName = `sticker-import-test-${crypto.randomUUID()}`;
		const workspace = await root.getDirectoryHandle(workspaceName, { create: true });
		setWorkspaceRoot(workspace);
		const file = fluentEmojiStickerFile(sticker, 512);
		const options = {
			projectId: 'project',
			attribution: fluentEmojiAttribution(sticker),
			tags: ['sticker', 'fluent-emoji'],
			insertAtFrame: 42,
			label: sticker.label
		};

		const first = await commitImportedAsset(file, options);
		expect(first.media).toMatchObject({
			storageType: 'workspace',
			fileName: 'sticker-party-popper.png',
			mimeType: 'image/png',
			width: 512,
			height: 512,
			tags: ['image', 'sticker', 'fluent-emoji'],
			attribution: {
				provider: 'Fluent Emoji',
				author: 'Microsoft Corporation',
				sourceId: 'party-popper',
				license: 'MIT',
				licenseUrl: 'https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE'
			}
		});
		expect(timelineStore.itemById.get(first.itemId)).toMatchObject({
			from: 42,
			type: 'image',
			mediaId: first.media.id,
			transform: { width: 346, height: 346 }
		});
		const source = await readBlob(
			workspace,
			mediaSourceByFileName(first.media.id, first.media.fileName)
		);
		expect(Array.from(new Uint8Array(await source!.slice(0, 8).arrayBuffer()))).toEqual([
			137, 80, 78, 71, 13, 10, 26, 10
		]);
		expect(await readJson<MediaMetadata>(workspace, mediaMetadataPath(first.media.id))).toEqual(
			first.media
		);

		const second = await commitImportedAsset(file, { ...options, insertAtFrame: 180 });
		expect(second.media.id).toBe(first.media.id);
		expect(mediaPool.mediaList).toHaveLength(1);
		expect(timelineStore.items).toHaveLength(2);
		expect(timelineStore.itemById.get(second.itemId)?.from).toBe(180);
		commandHistory.undo();
		expect(timelineStore.itemById.has(second.itemId)).toBe(false);
		expect(mediaPool.get(first.media.id)).toBeDefined();
	});
});
