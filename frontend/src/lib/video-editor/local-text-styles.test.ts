import { describe, expect, it } from 'vitest';
import { parseLocalVideoTextStyles } from './local-text-styles';

const style = {
	font_family: 'Geist Variable',
	font_size: 72,
	font_weight: 700,
	color: '#ffffff',
	align: 'center',
	background_color: '#00000000',
	outline_color: '#000000',
	outline_width: 0,
	shadow_blur: 12,
	animation: 'none'
};

describe('local video text styles', () => {
	it('parses complete saved styles', () => {
		expect(
			parseLocalVideoTextStyles(JSON.stringify([{ id: 'style-1', name: 'Heading', style }]))
		).toEqual([{ id: 'style-1', name: 'Heading', style }]);
	});

	it('drops malformed and out-of-range styles', () => {
		expect(
			parseLocalVideoTextStyles(
				JSON.stringify([
					{ id: 'style-1', name: 'Invalid weight', style: { ...style, font_weight: '700' } },
					{ id: 'style-2', name: 'Invalid animation', style: { ...style, animation: 'spin' } }
				])
			)
		).toEqual([]);
	});
});
