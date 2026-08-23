import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import {
	coupleVectorDimensions,
	separateVectorDimensions,
	vectorDimensionsNeedBake
} from './vector-dimensions';

function item(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'shape',
		trackId: 'visual',
		from: 0,
		durationInFrames: 60,
		label: 'Shape',
		type: 'shape',
		transform: { width: 400, height: 200 },
		...overrides
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

describe('vector dimension actions', () => {
	it('separates percentage scale into pixel lanes and couples it without a pose change', () => {
		timelineStore._setItems([
			item({
				vectorKeyframes: {
					scale: [
						{ id: 'a', frame: 0, value: { x: 100, y: 100 }, easing: 'linear' },
						{ id: 'b', frame: 30, value: { x: 200, y: 50 }, easing: 'ease-out' }
					]
				}
			})
		]);
		expect(separateVectorDimensions('shape', 'scale')).toBe(true);
		const separated = timelineStore.itemById.get('shape');
		expect(separated?.keyframes?.width?.values).toEqual([400, 800]);
		expect(separated?.keyframes?.height?.values).toEqual([200, 100]);
		expect(separated?.vectorKeyframes).toBeUndefined();
		expect(separated?.separatedVectorProperties).toEqual(['scale']);

		expect(coupleVectorDimensions('shape', 'scale')).toBe(true);
		const coupled = timelineStore.itemById.get('shape');
		expect(coupled?.vectorKeyframes?.scale?.map((keyframe) => keyframe.value)).toEqual([
			{ x: 100, y: 100 },
			{ x: 200, y: 50 }
		]);
		expect(coupled?.keyframes?.width).toBeUndefined();
		expect(coupled?.separatedVectorProperties).toEqual([]);
		expect(commandHistory.undoStack).toHaveLength(2);
	});

	it('flags mismatched axis timing before coupling bakes a shared lane', () => {
		const separated = item({
			keyframes: {
				anchorX: { frames: [0, 20], values: [100, 300], easings: ['linear', 'linear'] },
				anchorY: { frames: [0, 10, 20], values: [50, 80, 150], easings: ['linear'] }
			},
			separatedVectorProperties: ['anchor']
		});
		expect(vectorDimensionsNeedBake(separated, 'anchor')).toBe(true);
		timelineStore._setItems([separated]);
		expect(coupleVectorDimensions('shape', 'anchor')).toBe(false);
		expect(coupleVectorDimensions('shape', 'anchor', undefined, true)).toBe(true);
		expect(timelineStore.itemById.get('shape')?.vectorKeyframes?.anchor).toHaveLength(60);
	});

	it('requires a bake before separating a spatial path', () => {
		timelineStore._setItems([
			item({
				vectorKeyframes: {
					position: [
						{
							id: 'a',
							frame: 0,
							value: { x: 0, y: 0 },
							easing: 'linear',
							spatial: {
								inTangent: { x: 0, y: -100 },
								outTangent: { x: 0, y: 100 }
							}
						},
						{ id: 'b', frame: 30, value: { x: 60, y: 0 }, easing: 'linear' }
					]
				}
			})
		]);
		expect(separateVectorDimensions('shape', 'position')).toBe(false);
		expect(separateVectorDimensions('shape', 'position', true)).toBe(true);
		expect(timelineStore.itemById.get('shape')?.keyframes?.x?.frames).toHaveLength(60);
	});

	it('blocks conversions that would change link or expression targets', () => {
		timelineStore._setItems([
			item({
				vectorKeyframes: {
					scale: [{ id: 'scale', frame: 0, value: { x: 100, y: 100 }, easing: 'linear' }]
				},
				propertyLinks: [
					{
						type: 'link',
						targetProperty: 'scale',
						sourceItemId: 'shape',
						sourceProperty: 'position',
						enabled: false,
						timeOffsetFrames: 0
					}
				]
			})
		]);
		expect(separateVectorDimensions('shape', 'scale')).toBe(false);
	});
});
