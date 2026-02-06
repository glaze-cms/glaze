/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/**
 * Disallows any keys not present in the base type Shape.
 * Perfect for configuration objects where typos should be fatal.
 *
 * @example
 * ```typescript
 * type AllowedConfig = { apiKey: string; debug?: boolean };
 *
 * function configure<T extends AllowedConfig>(config: Strict<T, AllowedConfig>) {
 *   // implementation
 * }
 *
 * // ❌ Error: 'debbug' is not in AllowedConfig (typo detection)
 * configure({ apiKey: 'abc', debbug: true });
 *
 * // ✓ OK: All keys match AllowedConfig exactly
 * configure({ apiKey: 'abc', debug: true });
 * ```
 */
export type Strict<T, Shape> = T & Record<Exclude<keyof T, keyof Shape>, never>;

/**
 * Recursively makes all properties required, removing optional modifiers at every level.
 * Handles arrays by making elements required while preserving array structure.
 * Useful for ensuring complete configuration objects with no undefined values.
 *
 * @example
 * ```typescript
 * type Config = { db?: { host?: string; port?: number } };
 * type RequiredConfig = DeepRequired<Config>;
 * // Result: { db: { host: string; port: number } }
 *
 * type WithArray = { items?: { id?: number }[] };
 * type RequiredWithArray = DeepRequired<WithArray>;
 * // Result: { items: { id: number }[] }
 * ```
 */

export type DeepRequired<T> = T extends readonly any[]
	? { [K in keyof T]: DeepRequired<T[K]> }
	: T extends Function
		? T
		: T extends object
			? { [P in keyof T]-?: DeepRequired<T[P]> }
			: T;
