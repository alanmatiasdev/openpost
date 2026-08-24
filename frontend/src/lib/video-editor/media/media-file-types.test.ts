import { describe, expect, it } from 'vitest';
import { fileWithInferredMediaType, inferredMediaMimeType } from './media-file-types';

describe('media file type inference', () => {
	it('recovers browser-generic GIF, SVG, and container MIME types by extension', () => {
		expect(inferredMediaMimeType({ name: 'animation.gif', type: '' })).toBe('image/gif');
		expect(inferredMediaMimeType({ name: 'graphic.svg', type: 'text/xml' })).toBe('image/svg+xml');
		expect(inferredMediaMimeType({ name: 'camera.mkv', type: 'video/webm' })).toBe(
			'video/x-matroska'
		);
		const source = new File(['bytes'], 'still.webp');
		const normalized = fileWithInferredMediaType(source);
		expect(normalized.name).toBe(source.name);
		expect(normalized.type).toBe('image/webp');
		expect(normalized.lastModified).toBe(source.lastModified);
	});
});
