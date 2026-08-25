import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { planGroupTextScale } from './group-text-scale';

function textItem(patch: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'text',
		trackId: 'video',
		from: 0,
		durationInFrames: 30,
		label: 'Text',
		type: 'text',
		text: 'Launch',
		...patch
	};
}

describe('group text scaling', () => {
	it('scales every pixel-based text metric and preserves non-size style fields', () => {
		const plan = planGroupTextScale(
			textItem({
				fontSize: 40,
				letterSpacing: 2,
				paddingX: 12,
				paddingY: 8,
				borderRadius: 6,
				strokeWidth: 3,
				textShadow: { color: '#123456', offsetX: 4, offsetY: -2, blur: 5 },
				textSpans: [
					{ text: 'Launch', fontSize: 20, letterSpacing: 1, color: '#abcdef' },
					{ text: ' now', fontWeight: 700 }
				]
			}),
			1.5
		);
		expect(plan?.animated).toEqual({
			fontSize: 60,
			letterSpacing: 3,
			paddingX: 18,
			paddingY: 12,
			borderRadius: 9,
			strokeWidth: 4.5,
			textShadowOffsetX: 6,
			textShadowOffsetY: -3,
			textShadowBlur: 7.5
		});
		expect(plan?.itemPatch.textSpans).toEqual([
			{ text: 'Launch', fontSize: 30, letterSpacing: 1.5, color: '#abcdef' },
			{ text: ' now', fontWeight: 700, fontSize: undefined, letterSpacing: undefined }
		]);
	});

	it('uses the shared text defaults and ignores moves or non-text items', () => {
		expect(planGroupTextScale(textItem(), 2)?.animated).toEqual({
			fontSize: 120,
			letterSpacing: 0,
			paddingX: 32,
			paddingY: 32
		});
		expect(planGroupTextScale(textItem(), 1)).toBeNull();
		expect(planGroupTextScale({ ...textItem(), type: 'image' }, 2)).toBeNull();
	});
});
