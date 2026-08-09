import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';

export type ImageCaptionResult = components['schemas']['GenerateMediaAltTextOutputBody'];

export async function generateImageAltText(
	mediaID: string,
	locale: string,
	signal?: AbortSignal
): Promise<ImageCaptionResult | null> {
	const { data, error, response } = await client.POST('/media/{id}/alt-text/generate', {
		params: { path: { id: mediaID } },
		body: { locale },
		signal
	});

	if (response.status === 503 && error?.detail === 'automatic image captioning is not configured') {
		return null;
	}
	if (error || !data) {
		throw new Error(error?.detail ?? 'OpenPost could not generate image alt text.');
	}
	return data;
}
