/** Property names that can poison the prototype chain and must never be merged. */
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'] as const;

/**
 * Reports whether a key is safe to assign (not a prototype-pollution vector).
 *
 * @param key - The property key being merged.
 * @returns `true` when the key is safe to copy onto the result.
 */
function isSafeKey(key: string): boolean {
	return !DANGEROUS_KEYS.includes(key as (typeof DANGEROUS_KEYS)[number]);
}

/**
 * Reports whether a value is a plain object (not an array, `Date`, class instance, etc.).
 *
 * @param value - The value to test.
 * @returns `true` when the value is a plain `{}` object safe to merge into.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		value !== null &&
		typeof value === 'object' &&
		value.constructor === Object &&
		!Array.isArray(value)
	);
}

/**
 * Recursively merges `source` onto `target`, returning a new object.
 *
 * Objects merge deeply; arrays are replaced (and cloned); `undefined` source values are
 * skipped so they never clobber a defined default. Prototype-pollution keys are ignored.
 *
 * @param target - The base object (typically resolved defaults).
 * @param source - The override object (typically user input); may be partial or omitted.
 * @returns A new object with `source` applied over `target`.
 *
 * @example
 * ```ts
 * deepMerge({ a: 1, nested: { x: 1 } }, { nested: { y: 2 } });
 * // → { a: 1, nested: { x: 1, y: 2 } }
 * ```
 */
export function deepMerge<T>(target: T, source?: Partial<T>): T {
	if (!source) return target;
	if (!target) return source as T;

	const result = { ...target } as Record<string, unknown>;
	const sourceObject = source as Record<string, unknown>;

	for (const key of Object.keys(sourceObject)) {
		if (!isSafeKey(key)) continue;
		if (!Object.prototype.hasOwnProperty.call(sourceObject, key)) continue;

		const sourceValue = sourceObject[key];
		const targetValue = result[key];

		if (sourceValue === undefined) continue;

		if (Array.isArray(sourceValue)) {
			result[key] = [...(sourceValue as unknown[])];
		} else if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
			result[key] = deepMerge(targetValue, sourceValue);
		} else {
			result[key] = sourceValue;
		}
	}

	return result as T;
}
