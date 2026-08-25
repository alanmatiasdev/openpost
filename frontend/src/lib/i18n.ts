import { getLocale, setLocale, type Locale } from '$lib/paraglide/runtime';

export const localeLabels = {
	en: 'English',
	es: 'Español',
	fr: 'Français',
	de: 'Deutsch',
	pt: 'Português',
	'pt-BR': 'Português do Brasil',
	tr: 'Türkçe',
	ja: '日本語',
	ko: '한국어',
	zh: '简体中文'
} satisfies Record<Locale, string>;

export function getCurrentLocale(): Locale {
	return getLocale();
}

export function getLocaleTag(locale: Locale = getCurrentLocale()): string {
	switch (locale) {
		case 'es':
			return 'es-ES';
		case 'fr':
			return 'fr-FR';
		case 'de':
			return 'de-DE';
		case 'pt':
			return 'pt-PT';
		case 'pt-BR':
			return 'pt-BR';
		case 'tr':
			return 'tr-TR';
		case 'ja':
			return 'ja-JP';
		case 'ko':
			return 'ko-KR';
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
