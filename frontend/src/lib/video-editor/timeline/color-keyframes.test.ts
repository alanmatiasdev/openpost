import { describe, expect, it } from 'vitest';
import {
	colorStringToKeyframeValue,
	interpolateColorTrackToHex,
	keyframeValueToHexColor,
	normalizeHexColor
} from './color-keyframes';

describe('color keyframes', () => {
	it('round-trips short, RGB, and RGBA hex values', () => {
		expect(normalizeHexColor('#f0a')).toBe('#ff00aa');
		expect(normalizeHexColor('#f0a8')).toBe('#ff00aa88');
		for (const color of ['#123456', '#12345678']) {
			const value = colorStringToKeyframeValue(color);
			expect(value).not.toBeNull();
			expect(keyframeValueToHexColor(value!)).toBe(color);
		}
	});

	it('interpolates in OKLCH instead of treating packed color as one number', () => {
		const red = colorStringToKeyframeValue('#ff0000')!;
		const blue = colorStringToKeyframeValue('#0000ff')!;
		const midpoint = interpolateColorTrackToHex(
			{ frames: [0, 10], values: [red, blue] },
			5,
			'#000000'
		);
		expect(midpoint).toMatch(/^#[0-9a-f]{6}$/);
		expect(midpoint).not.toBe('#7f8080');
		expect(midpoint).not.toBe('#800080');
	});

	it('uses outgoing hold easing and keeps alpha', () => {
		const start = colorStringToKeyframeValue('#ff000040')!;
		const end = colorStringToKeyframeValue('#0000ffff')!;
		expect(
			interpolateColorTrackToHex(
				{ frames: [0, 10], values: [start, end], easings: ['hold', 'linear'] },
				5,
				'#00000000'
			)
		).toBe('#ff000040');
	});
});
