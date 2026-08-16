import { expect, test } from 'bun:test';

import { en } from './en.ts';
import { es } from './es.ts';

/**
 * Flattens a translation object into dotted key paths.
 *
 * @param value - The object to walk.
 * @param prefix - The path accumulated so far.
 * @returns Every leaf path, sorted.
 */
function toKeyPaths(value: object, prefix = ''): string[] {
	return Object.entries(value)
		.flatMap(([key, child]) => {
			const path = prefix ? `${prefix}.${key}` : key;
			return typeof child === 'object' && child !== null
				? toKeyPaths(child as object, path)
				: [path];
		})
		.toSorted();
}

test('every locale provides exactly the keys the base locale defines', () => {
	expect(toKeyPaths(es)).toEqual(toKeyPaths(en));
});

test('no translated string is left empty', () => {
	const empty = Object.entries({ en, es }).flatMap(([locale, translations]) =>
		toKeyPaths(translations)
			.filter((path) => {
				const value = path
					.split('.')
					.reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], translations);
				return typeof value !== 'string' || value.trim().length === 0;
			})
			.map((path) => `${locale}:${path}`),
	);

	expect(empty).toEqual([]);
});
