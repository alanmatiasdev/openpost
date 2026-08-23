import { describe, expect, it } from 'vitest';
import {
	buildCueText,
	getCueFormatFlags,
	parseSubtitleCueText,
	toggleCueFormat
} from './subtitle-cue-format';

describe('subtitle cue formatting', () => {
	it('parses nested SRT, VTT, and ASS formatting into styled runs', () => {
		const parsed = parseSubtitleCueText(
			'{\\an8}<b>Hello <i>world</i></b> <font color="#ffd400"><u>now</u></font>'
		);

		expect(parsed).toEqual({
			alignment: { textAlign: 'center', verticalAlign: 'top' },
			isEmpty: false,
			plainText: 'Hello world now',
			spans: [
				{ text: 'Hello ', fontWeight: 700 },
				{ text: 'world', fontStyle: 'italic', fontWeight: 700 },
				{ text: ' ' },
				{ text: 'now', color: '#ffd400', underline: true }
			]
		});
	});

	it('edits plain copy and cue-wide flags without exposing or dropping alignment markup', () => {
		const previous = '{\\an3}<b>Ready</b>';
		const parsed = parseSubtitleCueText(previous);
		expect(getCueFormatFlags(parsed)).toEqual({
			bold: true,
			italic: false,
			underline: false
		});
		expect(buildCueText('Ship it', getCueFormatFlags(parsed), previous)).toBe(
			'{\\an3}<b>Ship it</b>'
		);
		expect(toggleCueFormat(previous, 'italic')).toBe('{\\an3}<b><i>Ready</i></b>');
		expect(toggleCueFormat(toggleCueFormat(previous, 'bold'), 'underline')).toBe(
			'{\\an3}<u>Ready</u>'
		);
	});
});
