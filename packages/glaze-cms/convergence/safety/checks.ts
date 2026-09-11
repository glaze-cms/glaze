/**
 * The individual data-safety probes. Each runs one read-only COUNT/GROUP BY against the live DB and
 * returns a {@link DataLossFinding} when the proposed change would fail or lose data, or `null` when
 * it is safe. All SQL is dialect-agnostic (Postgres + SQLite) and built only from escaped
 * identifiers and validated integer literals.
 *
 * Probes **fail closed**: an unreadable probe result throws (surfaced by the detector as
 * `could_not_verify`), never a silent "safe."
 */

import {
	assertNonNegativeInteger,
	quoteIdentifier,
	quoteQualifiedName,
	readCount,
} from '../sql.ts';

import type { DataLossFinding, QueryExecutor, UnsafeChange } from './types.ts';

/** A `set_not_null` change, narrowed. */
type SetNotNullChange = Extract<UnsafeChange, { kind: 'set_not_null' }>;
/** An `add_not_null_column` change, narrowed. */
type AddNotNullColumnChange = Extract<UnsafeChange, { kind: 'add_not_null_column' }>;
/** An `add_unique` change, narrowed. */
type AddUniqueChange = Extract<UnsafeChange, { kind: 'add_unique' }>;
/** A `narrow_column` change, narrowed. */
type NarrowColumnChange = Extract<UnsafeChange, { kind: 'narrow_column' }>;
/** A `drop_column` change, narrowed. */
type DropColumnChange = Extract<UnsafeChange, { kind: 'drop_column' }>;
/** The `drop_table` variant. */
type DropTableChange = Extract<UnsafeChange, { kind: 'drop_table' }>;

/**
 * Detects rows that already hold NULL in a column about to gain `NOT NULL`. Such a change is emitted
 * by drizzle-kit unguarded and fails at apply time (`query_error`) — this pre-empts it.
 *
 * @param query - The dialect-agnostic query executor.
 * @param change - The `set_not_null` change to probe.
 * @returns A finding when NULL rows exist, otherwise `null`.
 */
export async function checkNotNullOnExistingNulls(
	query: QueryExecutor,
	change: SetNotNullChange,
): Promise<DataLossFinding | null> {
	const table = quoteQualifiedName(change.schema, change.table);
	const column = quoteIdentifier(change.column);

	const rows = await query(`SELECT COUNT(*) AS c FROM ${table} WHERE ${column} IS NULL`);
	const nullCount = readCount(rows);

	if (nullCount === 0) return null;

	return { change, code: 'not_null_existing_nulls', affectedRows: nullCount };
}

/**
 * Detects a non-empty table gaining a `NOT NULL` column that has no default — every existing row
 * would violate the constraint, so the ALTER fails. Confirmed on both dialects: Postgres and current
 * SQLite reject this on a non-empty table but allow it on an empty one.
 *
 * @param query - The dialect-agnostic query executor.
 * @param change - The `add_not_null_column` change to probe.
 * @returns A finding when the table has rows and the column has no default, otherwise `null`.
 */
export async function checkNotNullColumnOnNonEmpty(
	query: QueryExecutor,
	change: AddNotNullColumnChange,
): Promise<DataLossFinding | null> {
	if (change.hasDefault) return null;

	const table = quoteQualifiedName(change.schema, change.table);

	const rows = await query(`SELECT COUNT(*) AS c FROM ${table}`);
	const rowCount = readCount(rows);

	if (rowCount === 0) return null;

	return { change, code: 'not_null_column_non_empty', affectedRows: rowCount };
}

/**
 * Detects duplicate values that would violate a new single-column `UNIQUE` constraint. The
 * `GROUP BY` uses the column's **declared collation**, so a case/accent-insensitive column (`citext`,
 * `COLLATE NOCASE`) correctly detects collisions a binary column would not (verified on SQLite).
 * NULLs are excluded by default (both dialects permit multiple NULLs), unless `nullsNotDistinct` is
 * set, in which case two or more NULLs count as one collision. `affectedRows` reports the number of
 * colliding value groups.
 *
 * **Residual gap:** a constraint that imposes a collation *different* from the column's default
 * cannot be reasoned about from the value alone — closing that needs the constraint's collation from
 * the schema diff (tracked for the drizzle-kit wiring), at which point this should probe under it or
 * return `could_not_verify`.
 *
 * @param query - The dialect-agnostic query executor.
 * @param change - The `add_unique` change to probe.
 * @returns A finding when colliding values exist, otherwise `null`.
 */
export async function checkUniqueOnDuplicates(
	query: QueryExecutor,
	change: AddUniqueChange,
): Promise<DataLossFinding | null> {
	const table = quoteQualifiedName(change.schema, change.table);
	const column = quoteIdentifier(change.column);

	const duplicatedValues = `SELECT ${column} FROM ${table} WHERE ${column} IS NOT NULL GROUP BY ${column} HAVING COUNT(*) > 1`;
	const rows = await query(`SELECT COUNT(*) AS c FROM (${duplicatedValues}) AS dup`);
	let collidingGroups = readCount(rows);

	if (change.nullsNotDistinct) {
		const nullRows = await query(`SELECT COUNT(*) AS c FROM ${table} WHERE ${column} IS NULL`);
		// Under NULLS NOT DISTINCT, two or more NULLs collide as a single duplicate group.
		if (readCount(nullRows) > 1) collidingGroups += 1;
	}

	if (collidingGroups === 0) return null;

	return { change, code: 'unique_duplicates', affectedRows: collidingGroups };
}

/**
 * Detects values longer than a column's proposed new maximum length. NULLs are naturally excluded
 * (`LENGTH(NULL)` is NULL, which is not `> maxLength`). Only meaningful on Postgres — the detector
 * skips this probe on SQLite, which does not enforce column length.
 *
 * @param query - The dialect-agnostic query executor.
 * @param change - The `narrow_column` change to probe.
 * @returns A finding when over-length values exist, otherwise `null`.
 */
export async function checkColumnLengthOverflow(
	query: QueryExecutor,
	change: NarrowColumnChange,
): Promise<DataLossFinding | null> {
	const table = quoteQualifiedName(change.schema, change.table);
	const column = quoteIdentifier(change.column);
	const maxLength = assertNonNegativeInteger(change.maxLength);

	const rows = await query(
		`SELECT COUNT(*) AS c FROM ${table} WHERE LENGTH(${column}) > ${String(maxLength)}`,
	);
	const overflowCount = readCount(rows);

	if (overflowCount === 0) return null;

	return { change, code: 'column_length_overflow', affectedRows: overflowCount };
}

/**
 * Detects whether a column about to be dropped still holds data. A `DROP COLUMN` succeeds silently
 * and does not change the table's row count, so the layer-2 oracle cannot see the loss — this is the
 * pre-flight gate for it. Counts only non-NULL values: dropping an empty table, or a column that is
 * entirely NULL, destroys nothing and is safe.
 *
 * @param query - The dialect-agnostic query executor.
 * @param change - The `drop_column` change to probe.
 * @returns A finding when the column holds non-NULL values, otherwise `null`.
 */
export async function checkColumnHasData(
	query: QueryExecutor,
	change: DropColumnChange,
): Promise<DataLossFinding | null> {
	const table = quoteQualifiedName(change.schema, change.table);
	const column = quoteIdentifier(change.column);

	const rows = await query(`SELECT COUNT(${column}) AS c FROM ${table}`);
	const populatedRows = readCount(rows);

	if (populatedRows === 0) return null;

	return { change, code: 'column_has_data', affectedRows: populatedRows };
}

/**
 * Detects whether a table about to be dropped still holds rows. Dropping an empty table destroys
 * nothing and should stop nobody; dropping a populated one is the decision this whole feature exists
 * to put in front of a person, and it has to be made before anything runs.
 *
 * @param query - The dialect-agnostic query executor.
 * @param change - The `drop_table` change to probe.
 * @returns A finding when the table holds rows, otherwise `null`.
 */
export async function checkTableHasRows(
	query: QueryExecutor,
	change: DropTableChange,
): Promise<DataLossFinding | null> {
	const table = quoteQualifiedName(change.schema, change.table);

	const rows = await query(`SELECT COUNT(*) AS c FROM ${table}`);
	const rowCount = readCount(rows);

	if (rowCount === 0) return null;

	return { change, code: 'table_has_rows', affectedRows: rowCount };
}
