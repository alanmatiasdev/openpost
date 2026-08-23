import { describe, expect, it } from 'vitest';
import { segmentTextUnits } from './text-motion-segmentation';

describe('text motion segmentation', () => {
	it('assigns character units globally while preserving whitespace', () => {
		expect(segmentTextUnits(['A B', 'C'], 'character')).toEqual({
			lineUnitIndices: [[0, null, 1], [2]],
			unitCount: 3
		});
	});

	it('attaches punctuation to adjacent words', () => {
		expect(segmentTextUnits(['“Hello,” world!'], 'word')).toEqual({
			lineUnitIndices: [[0, 0, 0, 0, 0, 0, 0, 0, null, 1, 1, 1, 1, 1, 1]],
			unitCount: 2
		});
	});

	it('shares one unit per line or for the whole clip', () => {
		expect(segmentTextUnits(['A B', 'C'], 'line')).toEqual({
			lineUnitIndices: [[0, 0, 0], [1]],
			unitCount: 2
		});
		expect(segmentTextUnits(['A B', 'C'], 'whole-clip')).toEqual({
			lineUnitIndices: [[0, null, 0], [0]],
			unitCount: 1
		});
	});

	it('uses locale-aware word boundaries for text without spaces', () => {
		const result = segmentTextUnits(['你好世界'], 'word');
		expect(result.unitCount).toBeGreaterThan(0);
		expect(result.lineUnitIndices[0]).toHaveLength(4);
		expect(result.lineUnitIndices[0]).not.toContain(null);
	});
});
