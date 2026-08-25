import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import type { MediaMetadata } from '$lib/video-editor/media/types';
import StockBrowserPanel from './stock-browser-panel.svelte';
import '../../../routes/layout.css';

const asset = {
	provider: 'pixabay',
	provider_url: 'https://pixabay.com',
	external_id: 'photo:12',
	kind: 'photo',
	title: 'Orange desk',
	creator_name: 'Ada',
	creator_url: 'https://pixabay.com/users/ada',
	source_url: 'https://pixabay.com/photos/12',
	thumbnail_url:
		'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"%3E%3Crect width="16" height="9" fill="%23f97316"/%3E%3Ccircle cx="8" cy="4.5" r="2" fill="white"/%3E%3C/svg%3E',
	width: 1600,
	height: 900,
	duration_seconds: 0,
	license_name: 'Pixabay Content License',
	license_url: 'https://pixabay.com/service/license-summary/',
	attribution_text: 'Image by Ada on Pixabay'
};

const services = {
	listProviders: vi.fn(async () => [
		{
			key: 'pixabay',
			name: 'Pixabay',
			provider_url: 'https://pixabay.com',
			photos: true,
			videos: true,
			audio: false,
			photo_filters: ['orientation', 'media_subtype', 'color'],
			video_filters: ['orientation'],
			attribution: 'Images and videos provided by Pixabay'
		}
	]),
	search: vi.fn(async () => ({
		provider: 'pixabay',
		provider_url: 'https://pixabay.com',
		items: [asset],
		page: 1,
		per_page: 24,
		total: 1,
		has_more: false
	})),
	resolve: vi.fn(async () => ({
		...asset,
		download_url: 'https://cdn.example.com/full.jpg',
		mime_type: 'image/jpeg'
	}))
};

const committedMedia: MediaMetadata = {
	id: 'stock-media',
	storageType: 'workspace',
	fileName: 'orange-desk.jpg',
	fileSize: 3,
	mimeType: 'image/jpeg',
	duration: 0,
	width: 1600,
	height: 900,
	fps: 0,
	codec: 'jpeg',
	bitrate: 0,
	tags: ['image', 'stock', 'pixabay']
};

beforeEach(() => {
	timelineStore.__resetForTesting();
	timelineStore.setAll({ fps: 30, currentFrame: 123 });
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				new Response(new Uint8Array([1, 2, 3]), {
					status: 200,
					headers: { 'content-type': 'image/jpeg', 'content-length': '3' }
				})
		)
	);
});

afterEach(() => vi.unstubAllGlobals());

describe('StockBrowserPanel', () => {
	it('searches, preserves source credit, and inserts at the playhead', async () => {
		const commitAsset = vi.fn(async () => ({
			media: committedMedia,
			itemId: 'stock-item'
		}));
		const oninserted = vi.fn();
		const screen = await render(StockBrowserPanel, {
			projectId: 'project-1',
			oninserted,
			commitAsset,
			services
		});
		await screen.getByRole('textbox', { name: 'Search stock media' }).fill('desk');
		await screen.getByRole('button', { name: 'Search', exact: true }).click();
		await expect.element(screen.getByText('Orange desk')).toBeVisible();
		await screen.getByRole('button', { name: 'Add at playhead' }).click();

		expect(commitAsset).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'pixabay-photo-12.jpg',
				type: 'image/jpeg'
			}),
			expect.objectContaining({
				projectId: 'project-1',
				insertAtFrame: 123,
				label: 'Orange desk',
				tags: ['stock', 'pixabay'],
				attribution: {
					provider: 'pixabay',
					author: 'Ada',
					authorUrl: 'https://pixabay.com/users/ada',
					sourceId: 'photo:12',
					license: 'Pixabay Content License',
					licenseUrl: 'https://pixabay.com/service/license-summary/'
				}
			})
		);
		expect(oninserted).toHaveBeenCalledWith('stock-item');
	});

	it('fits a search result in the narrow editor rail', async () => {
		await page.viewport(390, 844);
		const screen = await render(StockBrowserPanel, {
			projectId: 'project-1',
			oninserted: vi.fn(),
			commitAsset: vi.fn(),
			services
		});
		screen.container.style.width = '260px';
		screen.container.style.height = '680px';
		screen.container.style.background = 'oklch(0.15 0.008 55)';
		await screen.getByRole('textbox', { name: 'Search stock media' }).fill('desk');
		await screen.getByRole('button', { name: 'Search', exact: true }).click();
		await expect.element(screen.getByText('Orange desk')).toBeVisible();
		await page.screenshot({
			element: screen.container,
			path: '../../../../.svelte-kit/openpost-stock-panel.png'
		});
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
	});
});
