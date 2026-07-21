/**
 * Layer-1 pre-flight: catch the data loss the row-count oracle (layer 2) cannot see, before applying.
 *
 * `generate` writes a structured `snapshot.json` (a flat `ddl` array of entities) next to each
 * migration. Diffing the new snapshot's columns against its **parent** snapshot's (found via
 * `prevIds`) is a clean, non-text source for *what changed per column* — a dropped column, a narrowed
 * type, a new `NOT NULL`. Those become {@link UnsafeChange} descriptors, which the existing safety
 * probes ({@link detectDataLoss}) vet against the **live database**. A column drop is the headline
 * case: it succeeds silently and preserves the table's row count, so only this pre-flight can see it.
 *
 * **Fails closed.** The new snapshot always exists (generate just wrote it); if it or a parent that
 * `prevIds` claims to exist cannot be read, that is an `error`, never a silent "safe". A first
 * migration (parent = the zero-UUID baseline) legitimately has no parent → an empty prior schema.
 *
 * Scope note: descriptors are derived for every table in the snapshot. When the internal-namespace
 * work lands (PG `glaze`/`glaze_auth` schemas, SQLite `zz__glaze` prefix), this must exclude those so
 * the gate never probes Glaze's own internal tables — see `glaze-internal-namespace-decision`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { detectDataLoss } from '../safety/index.ts';

import type { Dialect } from '../../dialect/index.ts';
import type { DataLossFinding, QueryExecutor, UnsafeChange } from '../safety/index.ts';

/** The empty-baseline parent id drizzle uses for a first migration (no real parent snapshot). */
const ZERO_SNAPSHOT_ID = '00000000-0000-0000-0000-000000000000';

/** The single column fact the differ needs, read defensively from a snapshot `ddl` entity. */
export interface SnapshotColumn {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	readonly type: string;
	readonly notNull: boolean;
	readonly hasDefault: boolean;
}

/** A snapshot reduced to what pre-flight needs: its identity, its parent link, and its columns. */
interface Snapshot {
	readonly id: string;
	readonly prevIds: readonly string[];
	readonly columns: readonly SnapshotColumn[];
}

/**
 * A column drizzle renamed on a surviving table (from a resolved rename decision). Its data carries
 * from `from` to `to`, so the differ must treat it as a rename — never a `drop_column` of `from` or a
 * new-column risk on `to`. Matched on `(table, name)` since a rename stays within one table.
 */
export interface ColumnRename {
	readonly table: string;
	readonly from: string;
	readonly to: string;
}

/** The outcome of {@link runPreflight}. */
export type PreflightResult =
	| { readonly status: 'safe' }
	| { readonly status: 'unsafe'; readonly findings: readonly DataLossFinding[] }
	| { readonly status: 'error'; readonly detail: string };

/**
 * Runs layer-1 pre-flight for a freshly-generated migration: derive the per-column changes from the
 * snapshot diff, then vet them against the live database.
 *
 * @param query - The dialect-agnostic query executor (the dialect seam's `DatabaseHandle.raw`).
 * @param dialect - The target dialect; gates dialect-specific probes.
 * @param migrationDir - The new migration's directory (holds the just-written `snapshot.json`).
 * @param out - The migration output directory (searched for the parent snapshot).
 * @param renamedColumns - Columns drizzle renamed (from resolved decisions), so the differ skips them.
 * @returns `safe` when no probe objects, `unsafe` with findings, or `error` when a snapshot is unreadable.
 */
export async function runPreflight(
	query: QueryExecutor,
	dialect: Dialect,
	migrationDir: string,
	out: string,
	renamedColumns: readonly ColumnRename[] = [],
): Promise<PreflightResult> {
	const next = readSnapshot(migrationDir);
	if (next === null) return { status: 'error', detail: 'could not read the generated snapshot' };

	const parent = resolveParentColumns(next, out);
	if (parent.status === 'error') return parent;

	const changes = deriveUnsafeChanges(parent.columns, next.columns, renamedColumns);
	if (changes.length === 0) return { status: 'safe' };

	const findings = await detectDataLoss(query, dialect, changes);
	return findings.length === 0 ? { status: 'safe' } : { status: 'unsafe', findings };
}

/**
 * Resolves the parent snapshot's columns for a new snapshot, following its `prevIds`. A first
 * migration (zero-UUID baseline) has no parent → an empty prior schema. A parent that `prevIds`
 * names but that cannot be found/read is an error (fail closed — never treated as empty).
 *
 * @param next - The freshly-generated snapshot.
 * @param out - The migration output directory to search for the parent.
 * @returns The parent's columns, or an error when a claimed parent is missing/unreadable.
 */
function resolveParentColumns(
	next: Snapshot,
	out: string,
): { status: 'ok'; columns: readonly SnapshotColumn[] } | { status: 'error'; detail: string } {
	if (next.prevIds.length > 1) {
		// A merge snapshot has several parents; diffing against only one would miss a drop introduced on
		// another branch (fail-open). Merges are the deferred team-conflict path — fail closed until then.
		return {
			status: 'error',
			detail: 'merge snapshot (multiple parents) is not yet supported by pre-flight',
		};
	}

	const parentId = next.prevIds[0];
	if (parentId === undefined || parentId === ZERO_SNAPSHOT_ID) {
		return { status: 'ok', columns: [] };
	}

	for (const dir of listMigrationDirs(out)) {
		const snapshot = readSnapshot(dir);
		if (snapshot?.id === parentId) return { status: 'ok', columns: snapshot.columns };
	}

	return { status: 'error', detail: `parent snapshot ${parentId} not found` };
}

/**
 * Diffs a parent snapshot's columns against the next snapshot's and derives the {@link UnsafeChange}
 * descriptors the safety probes understand. Columns are keyed by `(schema, table, name)`.
 *
 * - present → absent, **table still exists**, **not a rename** ⇒ `drop_column` (a table drop is the
 *   oracle's job; a renamed column carries its data, so both are skipped here).
 * - `NOT NULL` gained on an existing column ⇒ `set_not_null`.
 * - a string column narrowed to a smaller max length (incl. `text → varchar(n)`) ⇒ `narrow_column`.
 * - a new `NOT NULL` column on an existing table, **not a rename target** ⇒ `add_not_null_column`.
 *
 * @param parent - The parent snapshot's columns (empty for a first migration).
 * @param next - The new snapshot's columns.
 * @param renamedColumns - Columns drizzle renamed (from resolved decisions); excluded from drop/add.
 * @returns The unsafe-change descriptors to probe; empty when nothing needs vetting.
 */
export function deriveUnsafeChanges(
	parent: readonly SnapshotColumn[],
	next: readonly SnapshotColumn[],
	renamedColumns: readonly ColumnRename[] = [],
): UnsafeChange[] {
	const nextByKey = new Map(next.map((column) => [columnKey(column), column]));
	const parentKeys = new Set(parent.map((column) => columnKey(column)));
	const parentTables = new Set(parent.map((column) => tableKey(column)));
	const survivingTables = new Set(next.map((column) => tableKey(column)));
	const renamedFrom = new Set(renamedColumns.map((rename) => renameKey(rename.table, rename.from)));
	const renamedTo = new Set(renamedColumns.map((rename) => renameKey(rename.table, rename.to)));
	const changes: UnsafeChange[] = [];

	for (const before of parent) {
		const after = nextByKey.get(columnKey(before));

		if (after === undefined) {
			// A renamed column is not dropped — drizzle carries its data across via RENAME COLUMN — so
			// skip it rather than re-deriving a spurious `drop_column`.
			if (renamedFrom.has(renameKey(before.table, before.name))) continue;
			// A column drop only matters while its table survives; a whole-table drop is the oracle's job.
			if (survivingTables.has(tableKey(before))) {
				changes.push({ kind: 'drop_column', table: before.table, column: before.name });
			}
			continue;
		}

		if (!before.notNull && after.notNull) {
			changes.push({ kind: 'set_not_null', table: after.table, column: after.name });
		}

		const beforeMax = stringMaxLength(before.type);
		const afterMax = stringMaxLength(after.type);
		// When this holds, `afterMax` is finite (Infinity is never `<` anything), so it is a valid cap.
		if (beforeMax !== null && afterMax !== null && afterMax < beforeMax) {
			changes.push({
				kind: 'narrow_column',
				table: after.table,
				column: after.name,
				maxLength: afterMax,
			});
		}
	}

	for (const after of next) {
		// A new NOT NULL column only risks loss on a table that already existed (and may hold rows). A
		// brand-new table is created empty, so its columns — NOT NULL `id` included — lose nothing.
		const isNewColumn = !parentKeys.has(columnKey(after));
		// A rename target is not a new column — its data carried over from the old name.
		const isRenameTarget = renamedTo.has(renameKey(after.table, after.name));
		if (isNewColumn && !isRenameTarget && after.notNull && parentTables.has(tableKey(after))) {
			changes.push({
				kind: 'add_not_null_column',
				table: after.table,
				column: after.name,
				hasDefault: after.hasDefault,
			});
		}
	}

	return changes;
}

/**
 * Reads and reduces a migration directory's `snapshot.json` to a {@link Snapshot}. Defensive: any
 * missing file, bad JSON, or malformed shape yields `null` (the caller decides whether that is a
 * fail-closed error or a legitimately absent parent).
 *
 * @param migrationDir - The migration directory to read `snapshot.json` from.
 * @returns The reduced snapshot, or `null` when it cannot be read/parsed.
 */
function readSnapshot(migrationDir: string): Snapshot | null {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(join(migrationDir, 'snapshot.json'), 'utf8'));
	} catch {
		return null;
	}

	if (!isRecord(raw)) return null;
	const { id, prevIds, ddl } = raw;
	if (typeof id !== 'string' || !Array.isArray(prevIds) || !Array.isArray(ddl)) return null;

	return {
		id,
		prevIds: prevIds.filter((value): value is string => typeof value === 'string'),
		columns: ddl.filter(isRecord).flatMap(toColumn),
	};
}

/**
 * Reduces a raw `ddl` entity to a {@link SnapshotColumn}, keeping only `columns` entities with the
 * identifying fields present. Returns an empty array (dropped by `flatMap`) for any non-column or
 * malformed entity.
 *
 * @param entity - A raw `ddl` array entry.
 * @returns A single-element array with the column, or an empty array to skip it.
 */
function toColumn(entity: Record<string, unknown>): SnapshotColumn[] {
	if (entity['entityType'] !== 'columns') return [];
	const { schema, table, name, type } = entity;
	if (typeof table !== 'string' || typeof name !== 'string') return [];

	return [
		{
			schema: typeof schema === 'string' ? schema : '',
			table,
			name,
			type: typeof type === 'string' ? type : '',
			notNull: entity['notNull'] === true,
			hasDefault: entity['default'] != null,
		},
	];
}

/**
 * The character-length bound of a string column type: a finite cap for a bounded type (`varchar(n)`,
 * `char(n)`), `Infinity` for an unbounded string type (`text`, bare `varchar`), or `null` for a
 * non-string type (where a length narrowing cannot apply). Treating `text` as `Infinity` is what lets
 * the differ catch the common `text → varchar(n)` narrowing, not just `varchar(n) → varchar(m)`.
 *
 * @param type - The column's SQL type string from the snapshot.
 * @returns The max length (possibly `Infinity`), or `null` when the type is not string-like.
 */
function stringMaxLength(type: string): number | null {
	const normalized = type.trim().toLowerCase();
	const bounded = /^(?:varchar|character varying|char|character|nvarchar|nchar)\((\d+)\)$/.exec(
		normalized,
	);
	if (bounded) return Number(bounded[1]);
	if (/^(?:varchar|character varying|char|character|nvarchar|nchar|text|clob)$/.test(normalized)) {
		return Number.POSITIVE_INFINITY;
	}
	return null;
}

/**
 * Lists the migration directories in `out` as full paths, or `[]` when `out` does not exist.
 *
 * @param out - The migration output directory.
 * @returns The migration directory paths.
 */
function listMigrationDirs(out: string): string[] {
	try {
		return readdirSync(out, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(out, entry.name));
	} catch {
		return [];
	}
}

/**
 * The identity key for a column: schema + table + name (NUL-separated so identifiers can't collide).
 *
 * @param column - The column to key.
 * @returns The composite key.
 */
function columnKey(column: SnapshotColumn): string {
	return `${column.schema}\0${column.table}\0${column.name}`;
}

/**
 * The identity key for a column's table: schema + table.
 *
 * @param column - The column whose table to key.
 * @returns The composite table key.
 */
function tableKey(column: SnapshotColumn): string {
	return `${column.schema}\0${column.table}`;
}

/**
 * The identity key for a rename endpoint: table + column name (NUL-separated). Schema is omitted
 * because a rename decision carries `(table, column)` and stays within one table.
 *
 * @param table - The table name.
 * @param name - The column name.
 * @returns The composite `(table, name)` key.
 */
function renameKey(table: string, name: string): string {
	return `${table}\0${name}`;
}

/**
 * Narrows an unknown value to a non-null object (a record) for safe field access.
 *
 * @param value - The value to test.
 * @returns `true` when the value is a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
