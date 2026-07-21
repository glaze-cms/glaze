/**
 * Shared SQL-string helpers for convergence: safe identifier quoting, integer-literal validation,
 * and fail-closed COUNT reading. Used by both the data-safety probes (layer 1) and the atomic-apply
 * oracle (layer 2). Row values are never interpolated — only escaped identifiers and validated
 * integer literals reach SQL.
 */

/**
 * Escapes and double-quotes a single SQL identifier (unqualified — no schema prefix). Accepts any
 * legal identifier (hyphens, spaces, digits, Unicode) by doubling embedded double quotes, which
 * makes injection impossible while both Postgres and SQLite honor the result.
 *
 * No length bound is imposed: Postgres rejects/truncates over-long identifiers at DDL time (so a real
 * schema can't hold one), while SQLite permits long names — an artificial 63-byte cap here only
 * false-blocked valid SQLite identifiers.
 *
 * @param raw - The identifier as authored (e.g. `note`, `user-profiles`, `order id`).
 * @returns The safely double-quoted identifier (e.g. `"user-profiles"`).
 * @throws {Error} If `raw` is empty or contains a NUL byte.
 *
 * @example
 * ```ts
 * quoteIdentifier('note');          // → '"note"'
 * quoteIdentifier('user-profiles'); // → '"user-profiles"'
 * quoteIdentifier('a"b');           // → '"a""b"'
 * ```
 */
export function quoteIdentifier(raw: string): string {
	if (raw.length === 0) {
		throw new Error('SQL identifier must not be empty');
	}
	if (raw.includes('\0')) {
		throw new Error('SQL identifier must not contain a NUL byte');
	}

	return `"${raw.replaceAll('"', '""')}"`;
}

/**
 * Builds a schema-qualified table reference (`"schema"."table"`) when a schema is given, or a bare
 * quoted identifier otherwise (SQLite has no schema namespace). Used so the row-count oracle counts
 * exactly the relation introspection enumerated, rather than one resolved through `search_path`.
 *
 * @param schema - The schema name, or `undefined`/empty for an unqualified reference (SQLite).
 * @param table - The table name.
 * @returns The safely-quoted, optionally schema-qualified reference.
 *
 * @example
 * ```ts
 * quoteQualifiedName('public', 'users'); // → '"public"."users"'
 * quoteQualifiedName(undefined, 'users'); // → '"users"'
 * ```
 */
export function quoteQualifiedName(schema: string | undefined, table: string): string {
	return schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(table)}` : quoteIdentifier(table);
}

/**
 * Asserts a value is a non-negative integer safe to inline as a SQL literal.
 *
 * @param value - The candidate length/limit.
 * @returns The same value, once validated.
 * @throws {Error} If `value` is not a non-negative integer (rejects NaN, Infinity, floats, negatives).
 */
export function assertNonNegativeInteger(value: number): number {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`Expected a non-negative integer, received: ${String(value)}`);
	}

	return value;
}

/**
 * Reads a single COUNT result robustly across drivers, failing closed. Postgres returns `bigint`
 * counts (surfaced by postgres.js as a string), `bun:sqlite` returns a number — both normalize
 * here. Anything else (missing column, `null`, non-finite, unexpected shape) **throws**, so callers
 * treat an unreadable probe as an error rather than a false "safe."
 *
 * @param rows - The rows from a `SELECT COUNT(*) AS c …` probe (expected: exactly one row).
 * @returns The count as a number.
 * @throws {Error} If the count cannot be read as a finite number.
 */
export function readCount(rows: Array<Record<string, unknown>>): number {
	const value = rows[0]?.c;

	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'bigint') return Number(value);
	if (typeof value === 'string') {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}

	throw new Error(`Unreadable COUNT result: ${JSON.stringify(rows[0] ?? null)}`);
}
