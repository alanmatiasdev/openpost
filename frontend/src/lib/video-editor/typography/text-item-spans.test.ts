import { describe, expect, it } from 'vitest';
import {
	buildTextItemLabelFromText,
	getTextItemPlainText,
	getTextItemPrimaryText,
	getTextItemSpans
} from './text-item-spans';

describe('text item spans', () => {
	it('keeps legacy text items readable and gives structured spans priority', () => {
		expect(getTextItemSpans({ text: 'Hello world' })).toEqual([{ text: 'Hello world' }]);
		expect(
			getTextItemPlainText({
				text: 'Ignored',
				textSpans: [{ text: 'Headline' }, { text: 'Subtitle' }]
			})
		).toBe('Headline\nSubtitle');
	});

	it('uses the first structured span as the primary layout copy', () => {
		expect(getTextItemPrimaryText({ text: 'Headline\nSubtitle' })).toBe('Headline');
		expect(
			getTextItemPrimaryText({
				text: 'Ignored',
				textSpans: [{ text: 'Tag' }, { text: 'Headline' }]
			})
		).toBe('Tag');
	});

	it('builds a stable timeline label from the first line', () => {
		expect(buildTextItemLabelFromText('Headline\nSubtitle')).toBe('Headline');
		expect(buildTextItemLabelFromText('   \nSubtitle')).toBe('Text');
	});
});
