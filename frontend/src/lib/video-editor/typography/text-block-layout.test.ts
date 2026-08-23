import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import { layoutTextBlock, lineInkWidth } from './text-block-layout';
import { parseFontSizePx, type TextMeasurer } from './text-measurer';

function measurer(advancePerEm = 0.5): TextMeasurer {
	return {
		measure(text, cssFont, letterSpacing) {
			const fontSize = parseFontSizePx(cssFont);
			return text.length * fontSize * advancePerEm + text.length * letterSpacing;
		},
		fontMetrics(cssFont) {
			const fontSize = parseFontSizePx(cssFont);
			return { ascent: fontSize * 0.8, descent: fontSize * 0.2 };
		}
	};
}

function item(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'text',
		trackId: 'visual',
		from: 0,
		durationInFrames: 90,
		label: 'Text',
		text: 'CINEMA',
		type: 'text',
		color: '#ffffff',
		...overrides
	};
}

describe('text block layout', () => {
	it('matches CSS trailing letter spacing and centers the occupied box', () => {
		const layout = layoutTextBlock(
			item({ fontSize: 119, letterSpacing: 4, textAlign: 'center' }),
			1536,
			324,
			measurer()
		);
		const line = layout.lines[0]!;
		expect(line.width).toBeCloseTo(6 * 119 * 0.5 + 6 * 4);
		expect(line.startX).toBeCloseTo((1536 - line.width) / 2);
		expect(line.startX + lineInkWidth(line) / 2).toBeCloseTo(1536 / 2 - 2);
	});

	it('stacks mixed-size spans with their own font metrics', () => {
		const layout = layoutTextBlock(
			item({
				text: 'Tag\nHeadline\nSubtitle',
				textSpans: [
					{ text: 'Tag', fontSize: 20 },
					{ text: 'Headline', fontSize: 48 },
					{ text: 'Subtitle', fontSize: 28 }
				],
				lineHeight: 1.2,
				verticalAlign: 'middle'
			}),
			420,
			180,
			measurer()
		);
		expect(layout.lines.map((line) => line.text)).toEqual(['Tag', 'Headline', 'Subtitle']);
		expect(layout.totalHeight).toBeCloseTo((20 + 48 + 28) * 1.2);
		expect(layout.lines[1]!.top).toBeCloseTo(layout.lines[0]!.top + 20 * 1.2);
		expect(layout.lines[2]!.top).toBeCloseTo(layout.lines[1]!.top + 48 * 1.2);
	});

	it('sizes content backgrounds while preserving legacy full-box backgrounds', () => {
		const content = layoutTextBlock(
			item({
				text: 'BG',
				fontSize: 100,
				backgroundColor: '#000000',
				backgroundFit: 'content',
				borderRadius: 12,
				paddingX: 20,
				paddingY: 10
			}),
			800,
			300,
			measurer()
		).background!;
		expect(content.width).toBeCloseTo(100 + 40);
		expect(content.height).toBeCloseTo(120 + 20);
		expect(content.x).toBeCloseTo(400 - content.width / 2);
		expect(content.radius).toBe(12);

		expect(
			layoutTextBlock(item({ backgroundColor: '#000000' }), 800, 300, measurer()).background
		).toEqual({ x: 0, y: 0, width: 800, height: 300, radius: 0 });
	});

	it('flows inline color spans as one wrapped stream', () => {
		const layout = layoutTextBlock(
			item({
				text: 'OpenPost video editor',
				textSpans: [
					{ text: 'OpenPost ', color: '#ffffff' },
					{ text: 'video editor', color: '#ff7a00', underline: true }
				],
				spanLayout: 'inline',
				fontSize: 40,
				paddingX: 0,
				paddingY: 0
			}),
			1000,
			200,
			measurer()
		);
		expect(layout.lines).toHaveLength(1);
		expect(layout.lines[0]!.text).toBe('OpenPost video editor');
		expect(layout.lines[0]!.runs?.map((run) => [run.text, run.color, run.underline])).toEqual([
			['OpenPost ', '#ffffff', false],
			['video editor', '#ff7a00', true]
		]);
	});
});
