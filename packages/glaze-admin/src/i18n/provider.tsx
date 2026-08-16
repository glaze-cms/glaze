import { createContext, use } from 'react';

import type { Locale, Translations } from './types.ts';
import type { ReactNode } from 'react';

interface TranslationValue {
	readonly locale: Locale;
	readonly t: Translations;
}

const TranslationContext = createContext<TranslationValue | null>(null);

/**
 * Reads the active translations.
 *
 * @returns The translations and the active locale.
 * @throws {Error} When called outside a {@link TranslationProvider}.
 */
export function useTranslation(): TranslationValue {
	const value = use(TranslationContext);
	if (!value) throw new Error('useTranslation must be used inside a TranslationProvider.');
	return value;
}

/**
 * Provides translations to the tree.
 *
 * Translations are loaded before render (see `main.tsx`) and passed in, so no component ever renders
 * against a half-loaded locale or has to handle a loading state for its own labels.
 *
 * @param props.locale - The active locale.
 * @param props.translations - The strings for that locale.
 * @param props.children - The tree to render.
 * @returns The provider.
 */
export function TranslationProvider({
	locale,
	translations,
	children,
}: {
	locale: Locale;
	translations: Translations;
	children: ReactNode;
}) {
	return <TranslationContext value={{ locale, t: translations }}>{children}</TranslationContext>;
}
