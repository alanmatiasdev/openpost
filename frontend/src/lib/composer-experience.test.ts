import { describe, expect, it } from 'vitest';
import {
	normalizeComposerExperience,
	usesSpecializedTextComposer,
	usesUnifiedComposer
} from './composer-experience';

describe('composer experience', () => {
	it('keeps specialized composers as the safe default', () => {
		expect(normalizeComposerExperience(undefined)).toBe('specialized');
		expect(normalizeComposerExperience('unknown')).toBe('specialized');
		expect(usesUnifiedComposer(undefined)).toBe(false);
	});

	it('enables the unified composer only for an explicit preference', () => {
		expect(normalizeComposerExperience('unified')).toBe('unified');
		expect(usesUnifiedComposer('unified')).toBe(true);
	});

	it('uses specialized authoring only for text and thread presets', () => {
		expect(usesSpecializedTextComposer('specialized', 'post')).toBe(true);
		expect(usesSpecializedTextComposer('specialized', 'thread')).toBe(true);
		expect(usesSpecializedTextComposer('specialized', 'story')).toBe(false);
		expect(usesSpecializedTextComposer('unified', 'post')).toBe(false);
	});
});
