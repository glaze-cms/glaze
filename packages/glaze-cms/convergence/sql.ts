/**
 * Shared SQL-string helpers for convergence: safe identifier quoting, integer-literal validation,
 * and fail-closed COUNT reading. Used by both the data-safety probes (layer 1) and the atomic-apply
 * oracle (layer 2). Row values are never interpolated — only escaped identifiers and validated
 * integer literals reach SQL.
 */

/** Encoder reused for UTF-8 byte-length checks. */
const utf8 = new TextEncoder();

/**
 * Postgres truncates identifiers to 63 bytes (`NAMEDATALEN - 1`), which would silently make a probe
 * read a different object. SQLite has no such limit, but bounding both keeps behavior consistent and
 * turns an over-long name into a fail-closed error rather than a wrong verdict.
 */
const MAX_IDENTIFIER_BYTES = 63;

/**
 * Escapes and double-quotes a single SQL identifier (unqualified — no schema prefix). Accepts any
 * legal identifier (hyphens, spaces, digits, Unicode) by doubling embedded double quotes, which
 * makes injection impossible while both Postgres and SQLite honor the result.
 *
 * @param raw - The identifier as authored (e.g. `note`, `user-profiles`, `order id`).
 * @returns The safely double-quoted identifier (e.g. `"user-profiles"`).
 * @throws {Error} If `raw` is empty, contains a NUL byte, or exceeds {@link MAX_IDENTIFIER_BYTES}.
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
	if (utf8.encode(raw).length > MAX_IDENTIFIER_BYTES) {
		throw new Error(
			`SQL identifier exceeds ${String(MAX_IDENTIFIER_BYTES)} bytes: ${JSON.stringify(raw)}`,
		);
	}

	return `"${raw.replaceAll('"', '""')}"`;
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
