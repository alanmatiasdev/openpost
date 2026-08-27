import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, getMigrationsToApply } from './migrations';

describe('project migration registry', () => {
	it('returns an ordered contiguous migration plan', () => {
		expect(getMigrationsToApply(1, CURRENT_SCHEMA_VERSION).map((entry) => entry.version)).toEqual([
			2, 3, 4, 5
		]);
		expect(getMigrationsToApply(CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION)).toEqual([]);
	});

	it('fails closed when a target version has no migration', () => {
		expect(() => getMigrationsToApply(CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION + 1)).toThrow(
			`Missing project migration for schema ${CURRENT_SCHEMA_VERSION + 1}`
		);
	});
});
