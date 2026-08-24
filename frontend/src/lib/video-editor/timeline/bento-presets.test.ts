import { describe, expect, it } from 'vitest';
import { BENTO_PRESETS_STORAGE_KEY, loadBentoPresets, saveBentoPresets } from './bento-presets';

describe('Bento preset persistence', () => {
	it('validates, bounds, and de-duplicates untrusted saved JSON', () => {
		const storage = {
			getItem: (key: string) =>
				key === BENTO_PRESETS_STORAGE_KEY
					? JSON.stringify([
							{
								id: 'safe',
								name: '  Interview  ',
								preset: 'grid',
								cols: 999,
								rows: -2,
								gap: 900,
								padding: -20
							},
							{ id: 'safe', name: 'Duplicate', preset: 'row' },
							{ id: 'bad', name: '', preset: 'unknown' }
						])
					: null
		};
		expect(loadBentoPresets(storage)).toEqual([
			{
				id: 'safe',
				name: 'Interview',
				preset: 'grid',
				cols: 12,
				rows: 1,
				gap: 500,
				padding: 0
			}
		]);
	});

	it('does not let unavailable storage block editing', () => {
		expect(loadBentoPresets({ getItem: () => '{broken' })).toEqual([]);
		expect(() =>
			saveBentoPresets([], {
				setItem: () => {
					throw new Error('full');
				}
			})
		).not.toThrow();
	});
});
