/**
 * Environment-detection helpers, shared package-wide. Reads the cross-runtime `process.env` (present on
 * both Bun and Node), so no runtime-seam branch is needed.
 */

/** Env values that read as "off" for a boolean flag — an unset, empty, or explicitly-false value. */
const FALSY_FLAG_VALUES = new Set(['', '0', 'false', 'no', 'off']);

/**
 * Reports whether the process is running in production (`NODE_ENV === 'production'`).
 *
 * @returns `true` in production.
 */
export function isProduction(): boolean {
	return process.env['NODE_ENV'] === 'production';
}

/**
 * Reports whether the process is running under a test runner (`NODE_ENV === 'test'`).
 *
 * @returns `true` under test.
 */
export function isTestEnv(): boolean {
	return process.env['NODE_ENV'] === 'test';
}

/**
 * Reports whether an environment variable is set to a truthy flag value. Present-but-`0`/`false`/`no`/
 * `off` (and empty) all read as off, so `CI=false` is treated as unset rather than as "in CI".
 *
 * @param name - The environment variable name.
 * @returns `true` when the variable is set to a non-falsy value.
 */
export function isEnvFlagEnabled(name: string): boolean {
	const value = process.env[name]?.trim().toLowerCase();
	return value !== undefined && !FALSY_FLAG_VALUES.has(value);
}
