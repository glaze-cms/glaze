import { en } from './en.ts';

import type { Locale, Translations } from './types.ts';

/**
 * Lazily loads a locale's translations.
 *
 * English is returned directly because it is the base locale and is already in the entry bundle; every
 * other locale is a dynamic import, so its strings are a separate chunk.
 *
 * @param locale - The locale to load.
 * @returns The translations for that locale.
 */
export async function loadTranslations(locale: Locale): Promise<Translations> {
	if (locale === 'en') return en;

	const module = await import('./es.ts');
	return module.es;
}
