import { LOCALES, type Locale } from './types.ts';

/** Where an explicit locale choice is remembered between visits. */
const STORAGE_KEY = 'glaze.locale';

/** The locale used when nothing else matches. */
const DEFAULT_LOCALE: Locale = 'en';

/**
 * Narrows an arbitrary tag to a supported locale, matching on the language subtag so `es-419` resolves
 * to `es`.
 *
 * @param tag - A BCP 47 tag, or anything else.
 * @returns The matching locale, or `undefined`.
 */
function toLocale(tag: string | null | undefined): Locale | undefined {
	if (!tag) return undefined;
	const language = tag.toLowerCase().split('-')[0];
	return LOCALES.find((locale) => locale === language);
}

/**
 * Resolves which locale to render, preferring an explicit stored choice over the browser's languages.
 *
 * @returns A supported locale, falling back to English.
 */
export function detectLocale(): Locale {
	const stored = toLocale(globalThis.localStorage?.getItem(STORAGE_KEY));
	if (stored) return stored;

	for (const language of globalThis.navigator?.languages ?? []) {
		const detected = toLocale(language);
		if (detected) return detected;
	}

	return DEFAULT_LOCALE;
}

/**
 * Remembers an explicit locale choice for future visits.
 *
 * @param locale - The locale the viewer chose.
 */
export function storeLocale(locale: Locale): void {
	globalThis.localStorage?.setItem(STORAGE_KEY, locale);
}
