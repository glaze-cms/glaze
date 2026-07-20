/**
 * Maps drizzle-kit's open-string `error.code` onto Glaze's closed {@link ConvergenceErrorCode} set.
 * drizzle does not expose a literal union of codes (the type is `string`), so this table covers the
 * documented codes and everything else falls back to `unknown` — the UI always has a code to
 * translate. See `docs/research/drizzle-kit-rc-1.0-sdk.md` §2.
 */

import type { ConvergenceErrorCode } from './types.ts';

/** drizzle-kit `error.code` → Glaze {@link ConvergenceErrorCode}. Unlisted codes → `unknown`. */
const ERROR_CODE_MAP: Readonly<Record<string, ConvergenceErrorCode>> = {
	config_validation_error: 'config_invalid',
	config_file_not_found_error: 'config_not_found',
	schema_files_not_found_error: 'schema_not_found',
	missing_required_params_error: 'missing_params',
	ambiguous_params_error: 'missing_params',
	config_connection_error: 'connection_error',
	database_driver_error: 'driver_error',
	required_packages_error: 'driver_error',
	query_error: 'query_error',
	unsupported_schema_change: 'unsupported_change',
	unsupported_command_dialect_error: 'unsupported_change',
	invalid_hints: 'invalid_hints',
	check_error: 'check_failed',
	migrations_outdated_error: 'check_failed',
	orm_version_error: 'orm_version',
	internal_error: 'internal',
};

/**
 * Maps a raw drizzle-kit error code to Glaze's translatable code.
 *
 * @param rawCode - drizzle's `error.code` string.
 * @returns The mapped {@link ConvergenceErrorCode}, or `unknown` when unrecognized.
 */
export function toConvergenceErrorCode(rawCode: string): ConvergenceErrorCode {
	return ERROR_CODE_MAP[rawCode] ?? 'unknown';
}
