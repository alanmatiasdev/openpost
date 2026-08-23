import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import {
	CAPTION_STYLE_PRESETS,
	detectActiveCaptionPreset,
	resolveCaptionStylePatch
} from './caption-style-presets';

describe('caption style presets', () => {
	it('resolves the exact Netflix recipe without resetting hand-positioned transforms', () => {
		const preset = CAPTION_STYLE_PRESETS.find((candidate) => candidate.id === 'netflix')!;
		const patch = resolveCaptionStylePatch(preset, 1920, 1080, {
			x: 72,
			y: -15,
			width: 800,
			height: 200,
			anchorX: 0.25,
			flipHorizontal: true,
			aspectRatioLocked: false,
			rotation: 4,
			opacity: 0.8
		});

		expect(patch).toEqual({
			fontFamily: 'Inter',
			fontSize: 43,
			fontWeight: 600,
			fontStyle: 'normal',
			underline: false,
			color: '#ffffff',
			backgroundColor: 'rgba(0, 0, 0, 0.55)',
			backgroundFit: 'content',
			borderRadius: 4,
			textAlign: 'center',
			verticalAlign: 'middle',
			lineHeight: 1.15,
			letterSpacing: 0,
			paddingX: 12,
			paddingY: 12,
			textShadow: {
				offsetX: 0,
				offsetY: 2,
				blur: 6,
				color: 'rgba(0, 0, 0, 0.6)'
			},
			strokeWidth: 0,
			strokeColor: '#000000',
			transform: {
				x: 72,
				y: 389,
				width: 1344,
				height: 173,
				anchorX: 0.25,
				flipHorizontal: true,
				aspectRatioLocked: false,
				rotation: 4,
				opacity: 0.8
			}
		});
	});

	it('resolves and detects the exact TikTok recipe, then clears the match after a tweak', () => {
		const preset = CAPTION_STYLE_PRESETS.find((candidate) => candidate.id === 'tiktok')!;
		const patch = resolveCaptionStylePatch(preset, 1920, 1080);
		const item: TimelineItem = {
			id: 'subtitle-1',
			trackId: 'captions',
			from: 0,
			durationInFrames: 90,
			label: 'Captions',
			type: 'subtitle',
			...patch
		};

		expect(patch).toMatchObject({
			fontFamily: 'Anton',
			fontSize: 81,
			fontWeight: 400,
			letterSpacing: 1,
			strokeWidth: 2,
			strokeColor: '#000000',
			transform: {
				x: 0,
				y: 0,
				width: 1728,
				height: 238,
				rotation: 0,
				opacity: 1
			}
		});
		expect(detectActiveCaptionPreset(item, 1920, 1080)?.id).toBe('tiktok');
		expect(detectActiveCaptionPreset({ ...item, letterSpacing: 2 }, 1920, 1080)).toBeNull();
	});
});
