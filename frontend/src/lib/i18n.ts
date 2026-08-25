import { getLocale, setLocale, type Locale } from '$lib/paraglide/runtime';

export const localeLabels = {
	en: 'English',
	es: 'Español',
	de: 'Deutsch',
	pt: 'Português',
	ja: '日本語',
	zh: '简体中文'
} satisfies Record<Locale, string>;

export function getCurrentLocale(): Locale {
	return getLocale();
}

export function getLocaleTag(locale: Locale = getCurrentLocale()): string {
	switch (locale) {
		case 'es':
			return 'es-ES';
		case 'de':
			return 'de-DE';
		case 'pt':
			return 'pt-PT';
		case 'ja':
			return 'ja-JP';
		case 'zh':
			return 'zh-CN';
		case 'en':
		default:
			return 'en-US';
	}
}

export function switchLocale(locale: Locale) {
	return setLocale(locale);
}
