import { describe, expect, it } from 'vitest';
import { parseComposerMediaMetadata } from './media-metadata';

describe('composer media metadata', () => {
	it('parses valid metadata fields', () => {
		expect(
			parseComposerMediaMetadata({
				media: [{ id: 'media-1', mime_type: 'image/png', size: 128, alt_text: 'Preview' }]
			})
		).toEqual([{ id: 'media-1', mimeType: 'image/png', size: 128, altText: 'Preview' }]);
	});

	it('drops invalid records and fields', () => {
		expect(
			parseComposerMediaMetadata({ media: [{ id: 42 }, { id: 'media-1', size: '128' }] })
		).toEqual([{ id: 'media-1' }]);
	});
});
