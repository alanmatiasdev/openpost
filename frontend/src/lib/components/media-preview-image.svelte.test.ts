import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { setToken } from '$lib/api/client';
import MediaPreviewImage from './media-preview-image.svelte';

describe('media preview image', () => {
	afterEach(() => setToken(null));

	it('falls back to the original media when a thumbnail is unavailable', async () => {
		setToken('preview-token');
		const screen = await render(MediaPreviewImage, {
			mediaId: 'brand-logo',
			alt: 'Brand logo'
		});
		const image = screen.getByRole('img', { name: 'Brand logo' });
		const element = image.element();
		if (!(element instanceof HTMLImageElement)) throw new Error('Expected an image element.');

		expect(element.src).toContain('/media/brand-logo/thumb/md?token=preview-token');
		element.dispatchEvent(new Event('error'));
		expect(element.src).toContain('/media/brand-logo?token=preview-token');
		expect(element.src).not.toContain('/thumb/');
	});
});
