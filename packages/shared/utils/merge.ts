/**
 * Deep merge utility for configuration objects
 * Recursively merges source object into target object
 *
 * @param target - Base object (defaults)
 * @param source - Override object (user config)
 * @returns Merged object
 */
// Dangerous property names that can cause prototype pollution
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'] as const;

/**
 * Checks if a key is safe to use (not a prototype pollution vector)
 */
function isSafeKey(key: string): boolean {
	return !DANGEROUS_KEYS.includes(key as (typeof DANGEROUS_KEYS)[number]);
}

export function deepMerge<T>(target: T, source?: Partial<T>): T {
	if (!source) return target;
	if (!target) return source as T;

	const result = { ...target } as Record<string, unknown>;
	const sourceObj = source as Record<string, unknown>;

	// Iterate only over own keys to avoid inherited properties
	for (const key of Object.keys(sourceObj)) {
		// Skip dangerous keys to prevent prototype pollution
		if (!isSafeKey(key)) {
			continue;
		}

		// Ensure we're reading own properties only
		if (!Object.prototype.hasOwnProperty.call(sourceObj, key)) {
			continue;
		}

		const sourceValue = sourceObj[key];
		const targetValue = result[key];

		// Skip undefined values from source
		if (sourceValue === undefined) {
			continue;
		}

		// Arrays are replaced, not merged (clone to avoid mutation)
		if (Array.isArray(sourceValue)) {
			result[key] = [...(sourceValue as unknown[])];
		}
		// If both are plain objects, merge recursively
		else if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
			result[key] = deepMerge(targetValue, sourceValue);
		}
		// Otherwise, override with source value
		else {
			result[key] = sourceValue;
		}
	}

	return result as T;
}

/**
 * Check if value is a plain object (not Array, Date, etc.)
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		value !== null &&
		typeof value === 'object' &&
		value.constructor === Object &&
		!Array.isArray(value)
	);
}
