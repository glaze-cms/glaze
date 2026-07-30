/**
 * Constraint-violation classification, per dialect. A live INSERT/UPDATE that violates a database
 * constraint throws a driver-native, dialect-specific error; these pure functions recognize that error
 * and normalize it to a {@link ConstraintViolation} the content API maps onto a typed 4xx response.
 *
 * The shapes are matched to what each driver actually throws (verified empirically): Postgres
 * (`postgres.js`) carries a SQLSTATE `.code`; SQLite (`bun:sqlite` and `better-sqlite3`, identical)
 * carries a `SQLITE_CONSTRAINT_*` `.code` and a `"… constraint failed: table.column"` message.
 *
 * Column names are best-effort and are the ONLY thing extracted from the driver error — the raw driver
 * text is never surfaced, because some fields (e.g. Postgres `.detail` on a NOT NULL / CHECK failure)
 * echo the entire failing row's values.
 */

/** The kind of constraint a write violated, or `unknown` when it's a recognized-but-unclassified one. */
export type ConstraintKind = 'unique' | 'not_null' | 'foreign_key' | 'check' | 'unknown';

/** A normalized, dialect-agnostic constraint violation. */
export interface ConstraintViolation {
	/** Which constraint was violated. */
	readonly kind: ConstraintKind;
	/** The offending DB column name(s), best-effort — may be empty when the driver reports none. */
	readonly columns: readonly string[];
}

/**
 * Classifies a thrown error as a constraint violation, or returns `null` when it is not one (so a
 * genuine fault still surfaces as a 500 rather than a misleading 4xx).
 *
 * @param error - The value thrown by a write.
 * @returns The normalized violation, or `null` when the error is not a recognized constraint violation.
 */
export type ConstraintClassifier = (error: unknown) => ConstraintViolation | null;

/**
 * Reads a string-valued own property off an unknown error, safely.
 *
 * @param error - The thrown value.
 * @param key - The property to read.
 * @returns The string value, or `undefined` when absent or non-string.
 */
function readField(error: unknown, key: string): string | undefined {
	if (typeof error !== 'object' || error === null) return undefined;
	const value = (error as Record<string, unknown>)[key];
	return typeof value === 'string' ? value : undefined;
}

/**
 * Wraps a single optional column name as a column list.
 *
 * @param column - The column name, or `undefined`.
 * @returns A one-element list, or an empty list.
 */
function toColumns(column: string | undefined): string[] {
	return column ? [column] : [];
}

/**
 * Maps a Postgres SQLSTATE to a constraint kind. Codes in the `23` class are integrity-constraint
 * violations; the four named ones are classified, the rest are recognized but `unknown`.
 *
 * @param code - The SQLSTATE `.code`.
 * @returns The kind, or `null` when the code is not an integrity-constraint violation.
 */
function postgresKind(code: string): ConstraintKind | null {
	switch (code) {
		case '23505':
			return 'unique';
		case '23503':
			return 'foreign_key';
		case '23502':
			return 'not_null';
		case '23514':
			return 'check';
		default:
			return code.startsWith('23') ? 'unknown' : null;
	}
}

/**
 * Extracts the column name(s) from a Postgres error `.detail` of the form `Key (a, b)=(…) …`. Only the
 * parenthesized column-name group is read — never the value group that follows it.
 *
 * @param detail - The `.detail` string, if any.
 * @returns The column names, or an empty list.
 */
function parsePostgresKeyColumns(detail: string | undefined): string[] {
	if (!detail) return [];
	const match = /^Key \(([^)]+)\)=/.exec(detail);
	const group = match?.[1];
	if (!group) return [];
	return group
		.split(',')
		.map((column) => column.trim())
		.filter(Boolean);
}

/**
 * Maps a SQLite constraint error to a kind, from its `.code` suffix when present, falling back to the
 * message phrase (so it still classifies when extended result codes are disabled and `.code` is the bare
 * `SQLITE_CONSTRAINT`).
 *
 * @param code - The `.code`, if any.
 * @param message - The error message.
 * @returns The kind, or `null` when the error is not a constraint violation.
 */
function sqliteKind(code: string | undefined, message: string): ConstraintKind | null {
	const suffix = code ?? '';
	if (suffix.endsWith('_UNIQUE') || suffix.endsWith('_PRIMARYKEY')) return 'unique';
	if (suffix.endsWith('_NOTNULL')) return 'not_null';
	if (suffix.endsWith('_FOREIGNKEY')) return 'foreign_key';
	if (suffix.endsWith('_CHECK')) return 'check';
	if (message.includes('UNIQUE constraint failed')) return 'unique';
	if (message.includes('NOT NULL constraint failed')) return 'not_null';
	if (message.includes('FOREIGN KEY constraint failed')) return 'foreign_key';
	if (message.includes('CHECK constraint failed')) return 'check';
	if (suffix.startsWith('SQLITE_CONSTRAINT') || message.includes('constraint failed'))
		return 'unknown';
	return null;
}

/**
 * Extracts column name(s) from a SQLite `"… constraint failed: table.col[, table.col]"` message,
 * stripping the `table.` qualifier. Only called for kinds whose message tail is column-shaped (UNIQUE /
 * NOT NULL) — a CHECK message's tail is an expression, not a column, so it is never parsed here.
 *
 * @param message - The error message.
 * @returns The column names, or an empty list.
 */
function parseSqliteColumns(message: string): string[] {
	const marker = 'constraint failed: ';
	const index = message.indexOf(marker);
	if (index === -1) return [];
	return message
		.slice(index + marker.length)
		.split(',')
		.map((part) => {
			const trimmed = part.trim();
			const dot = trimmed.lastIndexOf('.');
			return dot === -1 ? trimmed : trimmed.slice(dot + 1);
		})
		.filter(Boolean);
}

/**
 * Classifies a single `postgres.js` error object (one link in the cause chain).
 *
 * @param error - The error object to inspect.
 * @returns The violation, or `null`.
 */
function classifyPostgresLink(error: unknown): ConstraintViolation | null {
	const code = readField(error, 'code');
	if (!code) return null;
	const kind = postgresKind(code);
	if (!kind) return null;
	if (kind === 'not_null') return { kind, columns: toColumns(readField(error, 'column_name')) };
	if (kind === 'unique' || kind === 'foreign_key')
		return { kind, columns: parsePostgresKeyColumns(readField(error, 'detail')) };
	return { kind, columns: [] };
}

/**
 * Classifies a single `bun:sqlite` / `better-sqlite3` error object (both drivers throw the same shape).
 *
 * @param error - The error object to inspect.
 * @returns The violation, or `null`.
 */
function classifySqliteLink(error: unknown): ConstraintViolation | null {
	const message = readField(error, 'message') ?? '';
	const kind = sqliteKind(readField(error, 'code'), message);
	if (!kind) return null;
	const columns = kind === 'unique' || kind === 'not_null' ? parseSqliteColumns(message) : [];
	return { kind, columns };
}

/**
 * Walks an error and its `cause` chain, returning the first link a per-link classifier recognizes.
 * Drizzle wraps a driver throw in a `DrizzleQueryError` and carries the real driver error (with the
 * SQLSTATE / `SQLITE_CONSTRAINT_*` code) on `.cause`, so the chain — not just the top — must be checked.
 *
 * @param error - The thrown value.
 * @param classifyLink - The per-dialect single-object classifier.
 * @returns The first recognized violation, or `null`.
 */
function classifyChain(
	error: unknown,
	classifyLink: (link: unknown) => ConstraintViolation | null,
): ConstraintViolation | null {
	const seen = new Set<unknown>();
	let current = error;
	while (current && typeof current === 'object' && !seen.has(current)) {
		seen.add(current);
		const violation = classifyLink(current);
		if (violation) return violation;
		current = (current as { cause?: unknown }).cause;
	}
	return null;
}

/**
 * Classifies a `postgres.js` error (or a wrapper carrying one on its `cause` chain) as a constraint
 * violation.
 *
 * @param error - The thrown value.
 * @returns The normalized violation, or `null` when it is not an integrity-constraint violation.
 */
export const classifyPostgresConstraint: ConstraintClassifier = (error) =>
	classifyChain(error, classifyPostgresLink);

/**
 * Classifies a `bun:sqlite` / `better-sqlite3` error (or a wrapper carrying one on its `cause` chain) as
 * a constraint violation.
 *
 * @param error - The thrown value.
 * @returns The normalized violation, or `null` when it is not a constraint violation.
 */
export const classifySqliteConstraint: ConstraintClassifier = (error) =>
	classifyChain(error, classifySqliteLink);
