import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateImageAltText } from './image-caption';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('$lib/api/client', () => ({
	client: { POST: mocks.post }
}));

describe('generateImageAltText', () => {
	beforeEach(() => {
		mocks.post.mockReset();
	});

	it('requests a localized caption for the selected media', async () => {
		const controller = new AbortController();
		const caption = {
			alt_text: 'Two people reviewing a design on a laptop.',
			generated: true,
			model: 'openai/gpt-5.6-luna'
		};
		mocks.post.mockResolvedValue({
			data: caption,
			error: undefined,
			response: new Response(null, { status: 200 })
		});

		await expect(generateImageAltText('media-1', 'pt-PT', controller.signal)).resolves.toEqual(
			caption
		);
		expect(mocks.post).toHaveBeenCalledWith('/media/{id}/alt-text/generate', {
			params: { path: { id: 'media-1' } },
			body: { locale: 'pt-PT' },
			signal: controller.signal
		});
	});

	it('treats an unconfigured caption service as an optional feature', async () => {
		mocks.post.mockResolvedValue({
			data: undefined,
			error: { detail: 'automatic image captioning is not configured' },
			response: new Response(null, { status: 503 })
		});

		await expect(generateImageAltText('media-1', 'en-US')).resolves.toBeNull();
	});

	it('surfaces actionable provider failures', async () => {
		mocks.post.mockResolvedValue({
			data: undefined,
			error: { detail: 'image captioning is temporarily unavailable' },
			response: new Response(null, { status: 502 })
		});

		await expect(generateImageAltText('media-1', 'en-US')).rejects.toThrow(
			'image captioning is temporarily unavailable'
		);
	});
});
