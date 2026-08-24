import { describe, expect, it } from 'vitest';
import {
	effectiveMediaStorageMode,
	fileWithInferredMediaType,
	prepareMediaImportFile
} from './media-file-types';
import { probeMediaFile } from './probe-client';

function transparentGif(): File {
	const bytes = Uint8Array.from(
		atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
		(character) => character.charCodeAt(0)
	);
	return fileWithInferredMediaType(new File([bytes], 'transparent.gif'));
}

describe('image media probe worker', () => {
	it('decodes GIF imports into stable image dimensions and thumbnails', async () => {
		const gif = await probeMediaFile(transparentGif());
		expect(gif.kind).toBe('image');
		expect([gif.width, gif.height]).toEqual([1, 1]);
		expect(gif.thumbnailBlob?.size).toBeGreaterThan(0);
	});

	it('decodes SVG imports into stable image dimensions and thumbnails', async () => {
		const svgFile = await prepareMediaImportFile(
			new File(
				[
					'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24"><rect width="40" height="24" fill="#dc2626"/></svg>'
				],
				'graphic.svg',
				{ type: 'text/xml' }
			)
		);
		expect(svgFile.name).toBe('graphic.png');
		expect(effectiveMediaStorageMode('link', { name: 'graphic.svg' }, svgFile)).toBe('copy');
		const svg = await probeMediaFile(svgFile);
		expect(svg.kind).toBe('image');
		expect([svg.width, svg.height]).toEqual([40, 24]);
		expect(svg.thumbnailBlob?.type).toBe('image/jpeg');
	});

	it('rejects active or externally linked SVG content before decoding', async () => {
		const unsafeSvg = new File(
			[
				'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><image href="https://example.test/tracker.png"/></svg>'
			],
			'unsafe.svg',
			{ type: 'image/svg+xml' }
		);

		await expect(prepareMediaImportFile(unsafeSvg)).rejects.toThrow(/active or external content/);
	});
});
