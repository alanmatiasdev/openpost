import { describe, expect, it } from 'vitest';
import {
	defaultFluentEmojiStickers,
	fluentEmojiAttribution,
	fluentEmojiStickerFile,
	parseFluentEmojiCatalog,
	searchFluentEmojiStickers
} from './fluent-emoji';

const fixture = {
	prefix: 'fluent-emoji-flat',
	width: 32,
	height: 32,
	icons: {
		'grinning-face': { body: '<path fill="#ff0" d="M0 0h32v32H0z"/>' },
		'face-with-tears-of-joy': {
			body: '<circle fill="#ff0" cx="16" cy="16" r="12"/>'
		},
		'party-popper': { body: '<path fill="#f00" d="M2 30 16 2l14 14z"/>' }
	}
};

describe('Fluent Emoji sticker catalog', () => {
	it('validates, labels, defaults, and searches the local catalog', () => {
		const catalog = parseFluentEmojiCatalog(fixture);
		expect(catalog.stickers).toHaveLength(3);
		expect(catalog.byName.get('party-popper')?.label).toBe('Party Popper');
		expect(defaultFluentEmojiStickers(catalog).map((item) => item.name)).toEqual([
			'grinning-face',
			'face-with-tears-of-joy',
			'party-popper'
		]);
		expect(searchFluentEmojiStickers(catalog, 'tears joy').map((item) => item.name)).toEqual([
			'face-with-tears-of-joy'
		]);
	});

	it('builds a self-contained SVG file and source metadata', async () => {
		const sticker = parseFluentEmojiCatalog(fixture).byName.get('party-popper')!;
		const file = fluentEmojiStickerFile(sticker, 512);
		expect(file.name).toBe('sticker-party-popper.svg');
		expect(file.type).toBe('image/svg+xml');
		expect(await file.text()).toContain('width="512" height="512" viewBox="0 0 32 32"');
		expect(fluentEmojiAttribution(sticker)).toMatchObject({
			provider: 'Fluent Emoji',
			author: 'Microsoft Corporation',
			sourceId: 'party-popper',
			license: 'MIT'
		});
	});

	it('rejects the wrong collection and catalogs without usable icons', () => {
		expect(() => parseFluentEmojiCatalog({ ...fixture, prefix: 'other' })).toThrow(/invalid/);
		expect(() =>
			parseFluentEmojiCatalog({
				prefix: 'fluent-emoji-flat',
				icons: { Bad_Name: { body: '' } }
			})
		).toThrow(/no usable/);
	});
});
