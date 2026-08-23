import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { collectAdjustmentLayers, effectsForItemAtFrame } from './adjustment-layers';

function track(id: string, order: number, visible = true): TimelineTrack {
	return {
		id,
		name: id,
		kind: 'video',
		height: 64,
		locked: false,
		visible,
		muted: false,
		solo: false,
		order
	};
}

function item(overrides: Partial<TimelineItem>): TimelineItem {
	return {
		id: 'item',
		trackId: 'content',
		from: 0,
		durationInFrames: 30,
		label: 'Item',
		type: 'video',
		...overrides
	};
}

const brightness = (id: string) => ({
	id,
	type: 'brightness' as const,
	enabled: true,
	amount: 1.2
});

describe('adjustment layer effects', () => {
	it('applies active visible layers above the item in top-to-bottom order before clip effects', () => {
		const tracks = [track('top', -1), track('middle', 0), track('content', 2)];
		const items = [
			item({
				id: 'middle-grade',
				trackId: 'middle',
				type: 'adjustment',
				effects: [brightness('b')]
			}),
			item({ id: 'top-grade', trackId: 'top', type: 'adjustment', effects: [brightness('a')] })
		];
		const clip = item({ effects: [brightness('clip')] });

		expect(
			effectsForItemAtFrame(clip, 2, collectAdjustmentLayers(items, tracks), 10).map(
				(effect) => effect.id
			)
		).toEqual(['a', 'b', 'clip']);
	});

	it('ignores hidden, inactive, lower, and disabled adjustment effects', () => {
		const tracks = [
			track('hidden', -2, false),
			track('top', -1),
			track('content', 0),
			track('lower', 1)
		];
		const items = [
			item({
				id: 'hidden',
				trackId: 'hidden',
				type: 'adjustment',
				effects: [brightness('hidden')]
			}),
			item({
				id: 'expired',
				trackId: 'top',
				type: 'adjustment',
				from: 0,
				durationInFrames: 5,
				effects: [brightness('expired')]
			}),
			item({
				id: 'disabled',
				trackId: 'top',
				type: 'adjustment',
				effects: [{ ...brightness('disabled'), enabled: false }]
			}),
			item({ id: 'lower', trackId: 'lower', type: 'adjustment', effects: [brightness('lower')] })
		];

		expect(effectsForItemAtFrame(item({}), 0, collectAdjustmentLayers(items, tracks), 10)).toEqual(
			[]
		);
	});

	it('uses only solo adjustment tracks when any track is soloed', () => {
		const solo = { ...track('solo', -1), solo: true };
		const layers = collectAdjustmentLayers(
			[
				item({ id: 'normal', trackId: 'normal', type: 'adjustment' }),
				item({ id: 'solo', trackId: 'solo', type: 'adjustment' })
			],
			[track('normal', -2), solo, track('content', 0)]
		);

		expect(layers.map(({ layer }) => layer.id)).toEqual(['solo']);
	});
});
