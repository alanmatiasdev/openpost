import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { parseFluentEmojiCatalog } from '$lib/video-editor/stickers/fluent-emoji';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import type { MediaMetadata } from '$lib/video-editor/media/types';
import StickerBrowserPanel from './sticker-browser-panel.svelte';
import '../../../routes/layout.css';

const catalog = parseFluentEmojiCatalog({
	prefix: 'fluent-emoji-flat',
	width: 32,
	height: 32,
	icons: {
		'grinning-face': { body: '<circle fill="#ff0" cx="16" cy="16" r="14"/>' },
		'party-popper': { body: '<path fill="#f00" d="M2 30 16 2l14 14z"/>' },
		rocket: { body: '<path fill="#09f" d="M4 28 16 2l12 26z"/>' }
	}
});

const committedMedia: MediaMetadata = {
	id: 'sticker-media',
	storageType: 'workspace',
	fileName: 'party-popper.png',
	fileSize: 3,
	mimeType: 'image/png',
	duration: 0,
	width: 1024,
	height: 1024,
	fps: 0,
	codec: 'png',
	bitrate: 0,
	tags: ['image', 'sticker']
};

beforeEach(() => {
	timelineStore.__resetForTesting();
	timelineStore.setAll({ fps: 30, currentFrame: 87 });
});

describe('StickerBrowserPanel', () => {
	it('searches the local catalog and inserts the selected sticker at the playhead', async () => {
		const commitAsset = vi.fn(async () => ({
			media: committedMedia,
			itemId: 'sticker-item'
		}));
		const oninserted = vi.fn();
		const screen = await render(StickerBrowserPanel, {
			projectId: 'project-1',
			oninserted,
			loadCatalog: vi.fn(async () => catalog),
			commitAsset
		});

		await screen.getByRole('textbox', { name: 'Search stickers' }).fill('party');
		await expect.element(screen.getByText('1 stickers')).toBeVisible();
		await screen.getByRole('button', { name: 'Add Party Popper at playhead' }).click();

		expect(commitAsset).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'sticker-party-popper.svg',
				type: 'image/svg+xml'
			}),
			expect.objectContaining({
				projectId: 'project-1',
				insertAtFrame: 87,
				label: 'Party Popper',
				tags: ['sticker', 'fluent-emoji'],
				attribution: expect.objectContaining({
					provider: 'Fluent Emoji',
					sourceId: 'party-popper',
					license: 'MIT'
				})
			})
		);
		expect(oninserted).toHaveBeenCalledWith('sticker-item');
	});

	it('fits the narrow editor rail without horizontal overflow', async () => {
		await page.viewport(390, 844);
		const screen = await render(StickerBrowserPanel, {
			projectId: 'project-1',
			oninserted: vi.fn(),
			commitAsset: vi.fn()
		});
		screen.container.style.width = '260px';
		screen.container.style.height = '680px';
		screen.container.style.background = 'oklch(0.15 0.008 55)';
		await expect.element(screen.getByText('Popular stickers')).toBeVisible();
		await page.screenshot({
			element: screen.container,
			path: '../../../../.svelte-kit/openpost-sticker-panel.png'
		});
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
	});
});
