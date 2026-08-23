import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import {
	buildEditableBaseSpans,
	buildSpanLayout,
	buildTextSingleLayoutDraft,
	cloneTextLayoutDrafts,
	getTextItemLayoutMode
} from './text-layout-drafts';

function textItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'text-1',
		trackId: 'visual',
		from: 0,
		durationInFrames: 90,
		label: 'Headline',
		text: 'Headline',
		type: 'text',
		color: '#ffffff',
		...overrides
	};
}

describe('text layout drafts', () => {
	it('detects all three layout modes and preserves the title when collapsing', () => {
		expect(getTextItemLayoutMode(textItem())).toBe('single');
		expect(getTextItemLayoutMode(textItem({ textSpans: [{ text: 'A' }, { text: 'B' }] }))).toBe(
			'two'
		);
		const three = textItem({
			fontSize: 60,
			textSpans: [
				{ text: 'Tag', fontSize: 24 },
				{ text: 'Headline', fontSize: 92, fontFamily: 'Bebas Neue', fontWeight: 700 },
				{ text: 'Subtitle', fontSize: 32 }
			]
		});
		expect(getTextItemLayoutMode(three)).toBe('three');
		expect(buildTextSingleLayoutDraft(three)).toMatchObject({
			text: 'Headline',
			fontSize: 92,
			fontFamily: 'Bebas Neue',
			fontWeight: 700
		});
	});

	it('builds FreeCut-compatible two and three span defaults', () => {
		const source = textItem({ text: 'Launch', fontSize: 100 });
		expect(buildSpanLayout(buildEditableBaseSpans(source), source, 2)).toEqual([
			{
				text: 'Launch',
				fontSize: 100,
				fontFamily: undefined,
				fontWeight: undefined,
				fontStyle: undefined,
				underline: undefined,
				color: '#ffffff',
				letterSpacing: undefined
			},
			{ text: 'Subtitle', fontSize: 48, fontWeight: 500, color: '#cbd5e1', letterSpacing: 1 }
		]);
		expect(buildSpanLayout(buildEditableBaseSpans(source), source, 3)).toEqual([
			{ text: 'Tag', fontSize: 30, fontWeight: 600, color: '#cbd5e1', letterSpacing: 2 },
			{
				text: 'Launch',
				fontSize: 100,
				fontFamily: undefined,
				fontWeight: undefined,
				fontStyle: undefined,
				underline: undefined,
				color: '#ffffff',
				letterSpacing: undefined
			},
			{ text: 'Subtitle', fontSize: 42, fontWeight: 500, color: '#cbd5e1', letterSpacing: 1 }
		]);
	});

	it('clones saved drafts without sharing span references', () => {
		const source = {
			single: { text: 'Single' },
			twoSpans: [{ text: 'Title' }, { text: 'Subtitle' }]
		};
		const copy = cloneTextLayoutDrafts(source)!;
		copy.single!.text = 'Changed';
		copy.twoSpans![0]!.text = 'Changed';
		expect(source).toEqual({
			single: { text: 'Single' },
			twoSpans: [{ text: 'Title' }, { text: 'Subtitle' }]
		});
	});
});
