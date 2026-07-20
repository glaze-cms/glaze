/**
 * The before/after row-count oracle. Captures each counted table's row count, then — after the
 * migration runs — flags any table that should have survived but lost rows (or disappeared). Pure
 * schema DDL never legitimately deletes rows, so a net decrease in a non-dropped, non-renamed table
 * is a real data-loss signal.
 *
 * **Exact guarantee (do not overstate — the Admin UI must not read a pass as "data is intact"):** it
 * detects only a **net row-count decrease** in the **counted** tables (Postgres: `public`-schema base
 * tables; excludes the migration table and `sqlite_*`). It does **NOT** catch:
 * - count-preserving corruption — a column drop, a type coercion/precision truncation, or a SQLite
 *   rebuild `INSERT…SELECT` that lands values in the wrong columns (a future per-column checksum);
 * - equal-count churn — deleting N rows and inserting N others nets zero;
 * - tables outside the counted scope (non-`public` schemas);
 * - loss under concurrent external writes (the before/after snapshots are not isolation-guarded;
 *   assume a quiesced database).
 * Counting all tables is also a cost on large schemas — future work may scope it to the migration's
 * affected tables (which would also remove the unrelated-table concurrency window).
 */

import { quoteIdentifier, readCount } from '../sql.ts';
import { listUserTables } from './introspection.ts';

import type { Dialect, RawExecutor } from '../../dialect/index.ts';
import type { TableRename, UnexpectedRowLoss } from './types.ts';

/**
 * Captures the row count of every user table, keyed by table name.
 *
 * @param query - A transaction-bound query executor.
 * @param dialect - The target dialect.
 * @returns A map of table name → row count.
 */
export async function captureRowCounts(
	query: RawExecutor,
	dialect: Dialect,
): Promise<Map<string, number>> {
	const tables = await listUserTables(query, dialect);
	const counts = new Map<string, number>();

	for (const table of tables) {
		// Sequential by design: these probes share one transaction-bound connection, which
		// serializes statements — parallelizing would be unsafe, not faster.
		// oxlint-disable-next-line no-await-in-loop
		const rows = await query(`SELECT COUNT(*) AS c FROM ${quoteIdentifier(table)}`);
		counts.set(table, readCount(rows));
	}

	return counts;
}

/**
 * Follows a rename chain to the table's final name after the migration, so `a→b→c` resolves `a` to
 * `c`. Guards against cycles (e.g. a swap `a→b, b→a`) by stopping when a name repeats.
 *
 * @param table - The table's pre-migration name.
 * @param renameTargetOf - Map of `from` → `to` for each rename.
 * @returns The table's final (post-migration) name.
 */
function resolveFinalName(table: string, renameTargetOf: ReadonlyMap<string, string>): string {
	const seen = new Set<string>([table]);
	let current = table;

	while (renameTargetOf.has(current)) {
		const next = renameTargetOf.get(current) as string;
		if (seen.has(next)) break;
		current = next;
		seen.add(current);
	}

	return current;
}

/**
 * Compares before/after row counts and reports tables that lost rows when they should not have.
 * Dropped tables are exempt; renamed tables are matched across the rename (including chains).
 *
 * The drop/rename lists are a **trust contract**: they must be derived from the same migration diff
 * that produced the statements. Over-reporting a drop hides a real truncation (false negative);
 * omitting a rename flags a safe migration (false positive). On Postgres, table names come back
 * case-folded (lowercased) from `information_schema`, so the supplied names must match that folding.
 *
 * @param before - Row counts captured before the migration.
 * @param after - Row counts captured after the migration.
 * @param droppedTables - Tables intentionally dropped (exempt from the check).
 * @param renamedTables - Tables renamed (matched across the rename).
 * @returns The unexpected losses, empty when every surviving table kept its rows.
 */
export function findUnexpectedLosses(
	before: ReadonlyMap<string, number>,
	after: ReadonlyMap<string, number>,
	droppedTables: ReadonlySet<string>,
	renamedTables: readonly TableRename[],
): UnexpectedRowLoss[] {
	const renameTargetOf = new Map(renamedTables.map((rename) => [rename.from, rename.to]));
	const losses: UnexpectedRowLoss[] = [];

	for (const [table, beforeCount] of before) {
		if (droppedTables.has(table)) continue;

		const survivingName = resolveFinalName(table, renameTargetOf);
		const afterCount = after.get(survivingName);

		if (afterCount === undefined) {
			losses.push({ table, before: beforeCount, after: 0 });
		} else if (afterCount < beforeCount) {
			losses.push({ table, before: beforeCount, after: afterCount });
		}
	}

	return losses;
}
