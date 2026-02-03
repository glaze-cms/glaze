/**
 * Disallows any keys not present in the base type Shape.
 * Perfect for configuration objects where typos should be fatal.
 *
 * @example
 * ```typescript
 * type Config = Strict<{ apiKey: string }, { apiKey: string; debug?: boolean }>;
 * // ❌ Error: { apiKey: string, debbug: true } - 'debbug' is not in Shape
 * // ✓ OK:   { apiKey: 'abc123' }
 * ```
 */
export type Strict<T, Shape> = T & Record<Exclude<keyof T, keyof Shape>, never>;

/**
 * Recursively makes all properties required, removing optional modifiers at every level.
 * Useful for ensuring complete configuration objects with no undefined values.
 *
 * @example
 * ```typescript
 * type Config = { db?: { host?: string; port?: number } };
 * type RequiredConfig = DeepRequired<Config>;
 * // Result: { db: { host: string; port: number } }
 * ```
 */
export type DeepRequired<T> = {
	[P in keyof T]-?: T[P] extends object
		? // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
			T[P] extends Function
			? T[P]
			: DeepRequired<T[P]>
		: T[P];
};
