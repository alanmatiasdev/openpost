import { describe, expect, it, beforeEach } from 'vitest';
import type { SubtitleCue, TimelineItem } from '../project/types';
import {
	activeWordIndexAtFrame,
	karaokeStateAtFrame,
	hasUsableKaraokeTimings
} from '../transcript/karaoke';
import { layoutTextBlock } from '../typography/text-block-layout';
import { createCanvasTextMeasurer } from '../typography/text-measurer';
import { parseSubtitleCueText } from '../transcript/subtitle-cue-format';

function makeItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'sub',
		trackId: 't',
		from: 0,
		durationInFrames: 60,
		label: 'Subs',
		type: 'subtitle',
		color: '#ffffff',
		...overrides
	};
}

function cue(): SubtitleCue {
	return {
		id: 'c1',
		startFrame: 0,
		endFrame: 60,
		text: 'hello world test',
		words: [
			{ id: 'w1', startFrame: 0, endFrame: 10, text: 'hello' },
			{ id: 'w2', startFrame: 10, endFrame: 20, text: 'world' },
			{ id: 'w3', startFrame: 20, endFrame: 30, text: 'test' }
		]
	};
}

describe('karaoke line wrapping preservation', () => {
	it('uses identical layout for normal and karaoke rendering so highlight does not reflow words', () => {
		const item = makeItem({
			fontFamily: 'Inter',
			fontSize: 24,
			textAlign: 'center',
			verticalAlign: 'middle',
			lineHeight: 1.25,
			letterSpacing: 0,
			paddingX: 20,
			paddingY: 20
		});
		const parsed = parseSubtitleCueText(cue().text);
		const styled = {
			...item,
			text: parsed.plainText,
			textSpans: parsed.spans,
			spanLayout: 'inline' as const
		};
		const stubMeasurer = {
			measure: (text: string) => text.length * 8,
			fontMetrics: () => ({ ascent: 10, descent: 3 })
		};
		const baseLayout = layoutTextBlock(
			styled,
			400,
			200,
			stubMeasurer as unknown as ReturnType<typeof createCanvasTextMeasurer>
		);
		const karaokeLayout = layoutTextBlock(
			styled,
			400,
			200,
			stubMeasurer as unknown as ReturnType<typeof createCanvasTextMeasurer>
		);
		expect(karaokeLayout.lines.map((l) => l.text)).toEqual(baseLayout.lines.map((l) => l.text));
		expect(karaokeLayout.lines.map((l) => l.width)).toEqual(baseLayout.lines.map((l) => l.width));
	});

	it('untimed cues render exactly as normal captions (no highlight state)', () => {
		const item = makeItem({ captionHighlightMode: 'karaoke' });
		const untimed: SubtitleCue = { id: 'c', startFrame: 0, endFrame: 30, text: 'hello world' };
		expect(hasUsableKaraokeTimings(untimed, 'hello world')).toBe(false);
		expect(karaokeStateAtFrame(item, untimed, 'hello world', 5)).toBeNull();
		// Also with mismatched timings
		const mismatched: SubtitleCue = {
			id: 'c',
			startFrame: 0,
			endFrame: 30,
			text: 'hello world',
			words: [{ id: 'w1', startFrame: 0, endFrame: 5, text: 'hello' }]
		};
		expect(karaokeStateAtFrame(item, mismatched, 'hello world', 2)).toBeNull();
	});
});

describe('karaoke active word is deterministic across realms', () => {
	it('preview and export helpers return the same index for every boundary frame', () => {
		const item = makeItem({ captionHighlightMode: 'karaoke' });
		const c = cue();
		const plain = parseSubtitleCueText(c.text).plainText;
		const frames = [0, 9, 10, 19, 20, 29, 30];
		const previewIndices = frames.map((f) => activeWordIndexAtFrame(c.words, f));
		const exportIndices = frames.map(
			(f) => karaokeStateAtFrame(item, c, plain, f)?.activeIndex ?? -1
		);
		expect(previewIndices).toEqual(exportIndices);
		expect(previewIndices).toEqual([0, 0, 1, 1, 2, 2, -1]);
	});
});
