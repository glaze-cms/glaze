/**
 * Deep merge utility for configuration objects
 * Recursively merges source object into target object
 *
 * @param target - Base object (defaults)
 * @param source - Override object (user config)
 * @returns Merged object
 */
export function deepMerge<T>(target: T, source?: Partial<T>): T {
	if (!source) return target;
	if (!target) return source as T;

	const result = { ...target } as Record<string, unknown>;
	const sourceObj = source as Record<string, unknown>;

	for (const key in sourceObj) {
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
