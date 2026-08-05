export const COMPOSER_EXPERIENCES = ['specialized', 'unified'] as const;

export type ComposerExperience = (typeof COMPOSER_EXPERIENCES)[number];

export const DEFAULT_COMPOSER_EXPERIENCE: ComposerExperience = 'specialized';

export function normalizeComposerExperience(value: unknown): ComposerExperience {
	return value === 'unified' ? 'unified' : DEFAULT_COMPOSER_EXPERIENCE;
}

export function usesUnifiedComposer(value: unknown): boolean {
	return normalizeComposerExperience(value) === 'unified';
}

export function usesSpecializedTextComposer(value: unknown, mode: string): boolean {
	return !usesUnifiedComposer(value) && (mode === 'post' || mode === 'thread');
}
