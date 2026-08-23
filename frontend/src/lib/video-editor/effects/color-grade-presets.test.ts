import { describe, expect, it } from 'vitest';
import {
	parseColorGradePresets,
	removeColorGradePreset,
	saveColorGradePreset
} from './color-grade-presets';

const grade = [
	{
		effectId: 'gpu-color-wheels',
		params: { lift: 0.2, gain: 1.1 },
		enabled: true
	}
];

describe('color grade presets', () => {
	it('rejects corrupt, non-color, and non-finite persisted entries', () => {
		expect(parseColorGradePresets('{')).toEqual([]);
		expect(
			parseColorGradePresets(
				JSON.stringify([
					{
						id: 'bad',
						name: 'Bad',
						effects: [{ effectId: 'gpu-gaussian-blur', params: {}, enabled: true }],
						createdAt: 1,
						updatedAt: 1
					},
					{
						id: 'nan',
						name: 'NaN',
						effects: [{ effectId: 'gpu-color-wheels', params: { lift: null }, enabled: true }],
						createdAt: 1,
						updatedAt: 1
					}
				])
			)
		).toEqual([]);
	});

	it('updates a same-name preset without changing its identity or creation time', () => {
		const created = saveColorGradePreset(
			[],
			'Warm',
			grade,
			() => 'preset',
			() => 10
		);
		const updated = saveColorGradePreset(
			created,
			'warm',
			[{ ...grade[0], params: { lift: -0.2 } }],
			() => 'unused',
			() => 20
		);
		expect(updated).toEqual([
			{
				id: 'preset',
				name: 'warm',
				effects: [{ ...grade[0], params: { lift: -0.2 } }],
				createdAt: 10,
				updatedAt: 20
			}
		]);
		expect(removeColorGradePreset(updated, 'preset')).toEqual([]);
	});

	it('clones preset params so later clip edits cannot mutate the library', () => {
		const presets = saveColorGradePreset(
			[],
			'Warm',
			grade,
			() => 'preset',
			() => 10
		);
		grade[0].params.lift = 1;
		expect(presets[0]?.effects[0]?.params.lift).toBe(0.2);
	});
});
