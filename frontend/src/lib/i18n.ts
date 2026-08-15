import { getLocale, setLocale, type Locale } from '$lib/paraglide/runtime';

export const localeLabels = {
	en: 'English',
	pt: 'Português'
} satisfies Record<Locale, string>;

export function getCurrentLocale(): Locale {
	return getLocale();
}

export function getLocaleTag(locale: Locale = getCurrentLocale()): string {
	switch (locale) {
		case 'pt':
			return 'pt-PT';
		case 'en':
		default:
			return 'en-US';
	}
}

export function switchLocale(locale: Locale) {
	return setLocale(locale);
}
