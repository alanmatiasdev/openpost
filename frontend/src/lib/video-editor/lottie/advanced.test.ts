import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { applyLottieColorOverrides, extractLottieColorLayers } from './color';
import {
	extractLottieAnimation,
	extractLottieManifest,
	extractLottieThemeData,
	parseLottieFileBytes
} from './metadata';
import { resolveLottieRenderSpec } from './render-spec';
import { extractLottieValueSlots } from './slots';
import { applyLottieTextOverrides, extractLottieTextLayers } from './text';

function templateAnimation(color: [number, number, number, number] = [1, 0, 0, 1]) {
	return {
		v: '5.12.2',
		w: 64,
		h: 64,
		fr: 30,
		ip: 0,
		op: 30,
		slots: {
			headline: { nm: 'Headline', p: { a: 1, k: [{ s: { t: 'Original' } }] } },
			opacity: { nm: 'Opacity', p: { a: 0, k: 80 } },
			offset: { nm: 'Offset', p: { a: 0, k: [12, -4] } },
			accent: { nm: 'Accent', p: { a: 0, k: color } }
		},
		layers: [
			{
				ty: 5,
				nm: 'Title fallback',
				t: { d: { sid: 'headline', k: [{ s: { t: 'Fallback' } }] } }
			},
			{
				ty: 4,
				nm: 'Art',
				shapes: [
					{ ty: 'fl', nm: 'Bound', c: { sid: 'accent' } },
					{ ty: 'fl', nm: 'Coat', c: { a: 0, k: [0, 0, 1, 1] } }
				]
			}
		]
	};
}

describe('advanced Lottie editing', () => {
	it('extracts and patches authored text and color slots', () => {
		const animation = templateAnimation();
		expect(extractLottieTextLayers(animation)).toEqual([
			{ key: 's:headline', text: 'Original', label: 'Headline' }
		]);
		expect(extractLottieColorLayers(animation)).toEqual([
			{ key: 's:accent', color: '#ff0000', label: 'Accent', named: true },
			{ key: 'c0', color: '#0000ff', label: 'Coat', named: true }
		]);

		const text = JSON.parse(applyLottieTextOverrides(animation, { 's:headline': 'OpenPost' })!);
		expect(text.slots.headline.p.k[0].s.t).toBe('OpenPost');
		expect(text.layers[0].t.d.k[0].s.t).toBe('OpenPost');

		const color = JSON.parse(applyLottieColorOverrides(animation, { 's:accent': '#00ff00' })!);
		expect(color.slots.accent.p.k).toEqual([0, 1, 0, 1]);
		expect(color.layers[1].shapes[0].c.k).toEqual([0, 1, 0, 1]);
	});

	it('keeps scalar and two-axis slots separate from colors and text', () => {
		expect(extractLottieValueSlots(templateAnimation())).toEqual([
			{ id: 'opacity', label: 'Opacity', type: 'scalar', value: 80 },
			{ id: 'offset', label: 'Offset', type: 'vector', value: [12, -4] }
		]);
	});

	it('selects archive animations, themes, and one shared render spec', () => {
		const primary = templateAnimation();
		const alternate = { ...templateAnimation([0, 1, 0, 1]), w: 96, op: 60 };
		const theme = { rules: [{ id: 'accent', type: 'Color', value: [0, 0, 1, 1] }] };
		const archive = zipSync({
			'manifest.json': strToU8(
				JSON.stringify({
					version: '1.0',
					animations: [{ id: 'primary', themes: ['night'] }, { id: 'alternate' }],
					themes: [{ id: 'night' }]
				})
			),
			'animations/primary.json': strToU8(JSON.stringify(primary)),
			'animations/alternate.json': strToU8(JSON.stringify(alternate)),
			'themes/night.json': strToU8(JSON.stringify(theme))
		});

		expect(extractLottieManifest(archive)).toEqual({
			animations: [{ id: 'primary' }, { id: 'alternate' }],
			themes: ['night']
		});
		expect(parseLottieFileBytes(archive, 'alternate')).toMatchObject({
			width: 96,
			totalFrames: 60
		});
		expect(extractLottieThemeData(archive, 'night')).toBe(JSON.stringify(theme));
		expect(extractLottieAnimation(archive, { animationId: 'alternate' })?.w).toBe(96);

		const spec = resolveLottieRenderSpec(archive, {
			animationId: 'alternate',
			themeId: 'night',
			textOverrides: { 's:headline': 'Changed' },
			colorOverrides: { c0: '#ffffff' },
			slotOverrides: { opacity: 50, offset: [3, 7] }
		});
		expect(JSON.parse(spec.data!).w).toBe(96);
		expect(JSON.parse(spec.data!).slots.headline.p.k[0].s.t).toBe('Changed');
		expect(JSON.parse(spec.data!).layers[1].shapes[1].c.k).toEqual([1, 1, 1, 1]);
		expect(spec.themeData).toBe(JSON.stringify(theme));
		expect(spec.slots).toEqual({ opacity: 50, offset: [3, 7] });
	});
});
