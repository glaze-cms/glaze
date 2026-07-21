/**
 * Environment-detection helpers, shared package-wide. Reads the cross-runtime `process.env` (present on
 * both Bun and Node), so no runtime-seam branch is needed.
 */

/**
 * Reports whether the process is running in production (`NODE_ENV === 'production'`).
 *
 * @returns `true` in production.
 */
export function isProduction(): boolean {
	return process.env['NODE_ENV'] === 'production';
}
