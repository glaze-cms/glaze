/**
 * Rejects any key not present in `Shape`, making typos in configuration objects fatal.
 *
 * @example
 * ```ts
 * type Allowed = { apiKey: string; debug?: boolean };
 * declare function configure<T extends Allowed>(config: Strict<T, Allowed>): void;
 *
 * configure({ apiKey: 'x', debbug: true }); // ✗ 'debbug' is not in Allowed
 * configure({ apiKey: 'x', debug: true }); // ✓
 * ```
 */
export type Strict<T, Shape> = T & Record<Exclude<keyof T, keyof Shape>, never>;
