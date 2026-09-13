/**
 * The data-safety detector: convergence's independent guard for the data-loss scenarios drizzle-kit
 * does not flag. Given proposed schema changes, the target dialect, and a live database, it runs the
 * matching probe for each and returns every confirmed problem — so the change becomes a translatable
 * decision surfaced to the user, never a mid-migration SQL failure. See
 * `specs/research/drizzle-kit-rc-1.0-sdk.md` §3.
 *
 * It **fails closed and per-change**: a probe that errors (missing object, unreadable result, bad
 * descriptor) yields a `could_not_verify` finding for that change only — it never throws away the
 * other changes' findings and never coerces the unknown to "safe."
 */

import { quoteIdentifier } from '../sql.ts';
import {
	checkColumnHasData,
	checkTableHasRows,
	checkColumnLengthOverflow,
	checkNotNullColumnOnNonEmpty,
	checkNotNullOnExistingNulls,
	checkUniqueOnDuplicates,
} from './checks.ts';

import type { Dialect } from '../../dialect/index.ts';
import type { DataLossFinding, QueryExecutor, UnsafeChange } from './types.ts';

/** The change kinds whose probe names an existing column. */
const PROBES_AN_EXISTING_COLUMN = new Set([
	'set_not_null',
	'add_unique',
	'narrow_column',
	'drop_column',
]);

/**
 * Makes a SQLite probe fail loudly when its column does not exist. SQLite reads an unknown
 * double-quoted name as a string literal, so `COUNT("body")` over a table with no `body` column counts
 * the word once per row and reports a populated column — a measurement of nothing, presented as
 * something. Postgres refuses the query, which is what the fail-closed path expects.
 *
 * @param query - The query executor.
 * @param change - The change about to be probed.
 * @throws {Error} When the column is not there, so the caller records `could_not_verify`.
 */
async function assertSqliteColumnExists(query: QueryExecutor, change: UnsafeChange): Promise<void> {
	if (!PROBES_AN_EXISTING_COLUMN.has(change.kind) || !('column' in change)) return;
	// `table_xinfo` lists generated columns too, which `table_info` leaves out.
	const columns = await query(`PRAGMA table_xinfo(${quoteIdentifier(change.table)})`);
	if (columns.length === 0) throw new Error(`table "${change.table}" does not exist`);
	const wanted = change.column.toLowerCase();
	if (!columns.some((row) => String(row['name']).toLowerCase() === wanted)) {
		throw new Error(`column "${change.column}" does not exist on "${change.table}"`);
	}
}

/**
 * Runs the probe matching a single change, resolving to a finding, or `null` when safe or not
 * applicable to the dialect. Never rejects: any thrown error becomes a `could_not_verify` finding so
 * one bad change cannot abort the batch or be mistaken for safe.
 *
 * @param query - The dialect-agnostic query executor.
 * @param dialect - The target dialect; gates dialect-specific probes.
 * @param change - The change to probe.
 * @returns A finding when unsafe or unverifiable, otherwise `null`.
 */
async function detectChange(
	query: QueryExecutor,
	dialect: Dialect,
	change: UnsafeChange,
): Promise<DataLossFinding | null> {
	try {
		if (dialect === 'sqlite') await assertSqliteColumnExists(query, change);
		switch (change.kind) {
			case 'set_not_null':
				return await checkNotNullOnExistingNulls(query, change);
			case 'add_not_null_column':
				return await checkNotNullColumnOnNonEmpty(query, change);
			case 'add_unique': {
				// `UNIQUE NULLS NOT DISTINCT` exists only on Postgres; ignore the flag on other dialects
				// so we never flag an impossible constraint.
				const normalized =
					change.nullsNotDistinct && dialect !== 'postgres'
						? { ...change, nullsNotDistinct: false }
						: change;
				return await checkUniqueOnDuplicates(query, normalized);
			}
			case 'narrow_column':
				// Column length is only enforced on Postgres; SQLite ignores it, so narrowing is safe.
				if (dialect !== 'postgres') return null;
				return await checkColumnLengthOverflow(query, change);
			case 'drop_column':
				// Dialect-agnostic: a drop destroys the column's data on both Postgres and SQLite.
				return await checkColumnHasData(query, change);
			case 'drop_table':
				return await checkTableHasRows(query, change);
			default: {
				const unexpected: never = change;
				throw new Error(`Unknown change kind: ${JSON.stringify(unexpected)}`);
			}
		}
	} catch (error) {
		return {
			change,
			code: 'could_not_verify',
			affectedRows: null,
			detail: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Runs every applicable data-safety probe and collects the confirmed problems. Probes are
 * independent and run concurrently; each contributes at most one finding, and the result preserves
 * the order of `changes`. Because {@link detectChange} never rejects, a single failing probe surfaces
 * as its own `could_not_verify` finding instead of losing the whole batch.
 *
 * @param query - The dialect-agnostic query executor (e.g. the dialect seam's `DatabaseHandle.raw`).
 * @param dialect - The target dialect; gates dialect-specific probes.
 * @param changes - The proposed schema changes to vet before applying.
 * @returns Findings for the unsafe or unverifiable changes, in `changes` order; empty when all are safe.
 */
export async function detectDataLoss(
	query: QueryExecutor,
	dialect: Dialect,
	changes: readonly UnsafeChange[],
): Promise<DataLossFinding[]> {
	const results = await Promise.all(changes.map((change) => detectChange(query, dialect, change)));

	return results.filter((finding): finding is DataLossFinding => finding !== null);
}
