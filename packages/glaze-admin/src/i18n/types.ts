import type { en } from './en.ts';

/**
 * The shape every locale must provide, derived from the base locale. Adding a key to `en.ts` makes every
 * other locale fail to typecheck until it is translated — that is the whole enforcement mechanism.
 */
export type Translations = typeof en;

/** The locales the admin ships. */
export const LOCALES = ['en', 'es'] as const;

/** A supported locale tag. */
export type Locale = (typeof LOCALES)[number];
