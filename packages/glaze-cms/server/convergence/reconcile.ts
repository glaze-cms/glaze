/**
 * What boot records about a request that is already on file, once it knows what this boot found.
 *
 * "Nothing pending, request on file" has opposite causes — the schema was reverted, or somebody
 * applied the change elsewhere — and recording the wrong one asserts that a change which destroyed
 * rows was retracted. So nothing here assumes, and nothing here trusts one source alone:
 *
 * - The **snapshot chain** says what was generated since the request was filed. It is evidence, not
 *   proof: the migration directory is committed to the repository, so a directory can come from a
 *   colleague's database, or be left behind by a process killed at the confirmation prompt.
 * - The **live database** is the witness. Before the trail says `applied`, the column or table the
 *   request would have dropped is looked for; gone means the change is in effect here, present means
 *   it is not, whatever the chain says.
 * - **This boot's result** says what happened just now.
 *
 * The answer is read off those three in order. When they cannot say, the request stays open and the
 * reason is logged; a trail that admits it does not know is worth more than one that guesses.
 */

import { findMigrationByHash } from '#convergence';

import type { ConvergeResult, DataLossFinding, SnapshotChain, UnsafeChange } from '#convergence';
import type { Dialect } from '#dialect';
import type { ApprovalEventType, OpenRequest } from '../approvals/index.ts';

/** An event to append to the open request, with what to say in it. */
export interface Resolution {
	readonly type: Extract<ApprovalEventType, 'applied' | 'superseded' | 'withdrawn'>;
	readonly payload?: Record<string, unknown>;
}

/** What boot decided about the open request. */
export type Reconciliation =
	/** Append this event; the request is closed. */
	| { readonly outcome: 'record'; readonly event: Resolution }
	/** The request still describes what is pending; nothing to record. */
	| { readonly outcome: 'still_open' }
	/** Boot cannot tell what happened; the request stays open and somebody has to look. */
	| { readonly outcome: 'unknown'; readonly reason: string };

/**
 * What the live database says about a request's targets — the columns and tables it would drop, the
 * columns it would narrow.
 *
 * - `gone`: every target has been dealt with — the change is in effect, and nothing on the way could
 *   have merely moved the data.
 * - `present`: at least one target is still there as it was — the change is not in effect.
 * - `undetermined`: the database cannot say. The request has a target nothing here can look for (an
 *   unclassified operation), a target's table is missing (dropped, or renamed with the data kept), or
 *   a rename sits between the request and now and "absent" could mean "moved".
 */
export type TargetState = 'gone' | 'present' | 'undetermined';

/** What is known about the path from the request's snapshot to now, beyond the database itself. */
export interface WitnessContext {
	/** Whether any migration generated since the request renames something. */
	readonly renamedOnPath: boolean;
}

/** A read-only query against the live database, the dialect seam's `raw`. */
type Query = (sql: string) => Promise<Array<Record<string, unknown>>>;

/**
 * The snapshot a request was measured against, if the request recorded it.
 *
 * @param open - The open request.
 * @returns The parent snapshot id, or `null` for a request filed before it was recorded.
 */
function parentOf(open: OpenRequest): string | null {
	const payload = open.payload as { parentSnapshotId?: unknown } | null;
	const parent = payload?.parentSnapshotId;
	return typeof parent === 'string' ? parent : null;
}

/**
 * The measured changes a request describes, read defensively out of its recorded findings.
 *
 * @param open - The open request.
 * @returns The changes it was measured for.
 */
function changesOf(open: OpenRequest): UnsafeChange[] {
	const payload = open.payload as { findings?: unknown } | null;
	const findings = Array.isArray(payload?.findings) ? (payload.findings as DataLossFinding[]) : [];
	return findings
		.map((finding) => finding?.change)
		.filter((change): change is UnsafeChange => change !== undefined && typeof change === 'object');
}

/**
 * Whether a request carries operations nothing can look for: unclassified ones.
 *
 * @param open - The open request.
 * @returns `true` when the request has unclassified operations.
 */
function hasUnclassified(open: OpenRequest): boolean {
	const payload = open.payload as { unclassified?: unknown } | null;
	return Array.isArray(payload?.unclassified) && payload.unclassified.length > 0;
}

/**
 * A single-quoted SQL literal for an identifier compared as data (in `information_schema`, or
 * `sqlite_master`).
 *
 * @param value - The identifier.
 * @returns The literal.
 */
function literal(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

/**
 * What the database says about one column: whether its table and it exist, and its declared character
 * length when it has one (Postgres only; SQLite does not enforce length and never narrows).
 *
 * @param query - The query executor.
 * @param dialect - The dialect.
 * @param schema - The schema on Postgres; ignored on SQLite.
 * @param table - The table name.
 * @param column - The column name.
 * @returns The column's state.
 */
async function readColumn(
	query: Query,
	dialect: Dialect,
	schema: string | undefined,
	table: string,
	column: string,
): Promise<{ table: boolean; column: boolean; maxLength: number | null }> {
	if (dialect === 'postgres') {
		const rows = await query(
			`select column_name, character_maximum_length from information_schema.columns where table_schema = ${literal(schema ?? 'public')} and table_name = ${literal(table)}`,
		);
		const match = rows.find((row) => row['column_name'] === column);
		const length = match?.['character_maximum_length'];
		return {
			table: rows.length > 0,
			column: match !== undefined,
			maxLength: typeof length === 'number' ? length : null,
		};
	}
	// `table_xinfo` lists generated columns too, which `table_info` leaves out.
	const rows = await query(`pragma table_xinfo(${literal(table)})`);
	const wanted = column.toLowerCase();
	return {
		table: rows.length > 0,
		column: rows.some((row) => String(row['name']).toLowerCase() === wanted),
		maxLength: null,
	};
}

/**
 * Whether a table exists in the live database.
 *
 * @param query - The query executor.
 * @param dialect - The dialect.
 * @param schema - The schema on Postgres; ignored on SQLite.
 * @param table - The table name.
 * @returns Whether it exists.
 */
async function tableExists(
	query: Query,
	dialect: Dialect,
	schema: string | undefined,
	table: string,
): Promise<boolean> {
	const rows =
		dialect === 'postgres'
			? await query(
					`select 1 from information_schema.tables where table_schema = ${literal(schema ?? 'public')} and table_name = ${literal(table)}`,
				)
			: await query(
					`select 1 from sqlite_master where type = 'table' and lower(name) = lower(${literal(table)})`,
				);
	return rows.length > 0;
}

/**
 * What the database says about one measured change.
 *
 * @param query - The query executor.
 * @param dialect - The dialect.
 * @param change - The change the request was measured for.
 * @returns Whether it is in effect (`gone`), not (`present`), or unknowable.
 */
async function witnessChange(
	query: Query,
	dialect: Dialect,
	change: UnsafeChange,
): Promise<TargetState> {
	switch (change.kind) {
		case 'drop_table':
			return (await tableExists(query, dialect, change.schema, change.table)) ? 'present' : 'gone';
		case 'drop_column': {
			const state = await readColumn(query, dialect, change.schema, change.table, change.column);
			// A missing table says nothing about the column: dropped, or renamed with the data kept.
			if (!state.table) return 'undetermined';
			return state.column ? 'present' : 'gone';
		}
		case 'narrow_column': {
			const state = await readColumn(query, dialect, change.schema, change.table, change.column);
			if (!state.table || !state.column || state.maxLength === null) return 'undetermined';
			return state.maxLength <= change.maxLength ? 'gone' : 'present';
		}
		default:
			// Never pending: the database refuses these, so they fail closed before a request is filed.
			return 'undetermined';
	}
}

/**
 * Looks in the live database for what a request would change, and says whether the change is in
 * effect. Every measured change has to be in effect for `gone`; one still standing is `present`; one
 * that cannot be checked, or a rename on the way that could have moved a target rather than dropped
 * it, is `undetermined` — `gone` is never asserted on a guess.
 *
 * @param query - The query executor (the dialect seam's `raw`).
 * @param dialect - The dialect.
 * @param open - The open request.
 * @param context - What is known about the path from the request to now.
 * @returns The target state.
 */
export async function checkTargets(
	query: Query,
	dialect: Dialect,
	open: OpenRequest,
	context: WitnessContext = { renamedOnPath: false },
): Promise<TargetState> {
	const changes = changesOf(open);
	if (changes.length === 0) return 'undetermined';

	const states = await Promise.all(changes.map((change) => witnessChange(query, dialect, change)));
	if (states.includes('present')) return 'present';
	if (states.includes('undetermined') || hasUnclassified(open) || context.renamedOnPath) {
		return 'undetermined';
	}
	return 'gone';
}

/**
 * Names what a request would change, for a message.
 *
 * @param open - The open request.
 * @returns The targets, comma-separated.
 */
function describeTargets(open: OpenRequest): string {
	return changesOf(open)
		.map((change) => ('column' in change ? `${change.table}.${change.column}` : change.table))
		.join(', ');
}

/** The witness read twice: before this boot converged, and after. */
export interface Witness {
	/** What the database said before this boot changed anything. */
	readonly before: TargetState;
	/** What it says now. */
	readonly after: TargetState;
}

/**
 * Works out what happened to an open request, from the chain as it stood before this boot converged,
 * from what the database said before and after, and from what this boot then found. The reading
 * from before this boot answers for what others did; the reading from after answers for this boot.
 *
 * @param open - The request on file.
 * @param result - What this boot's convergence found.
 * @param out - The migration output directory.
 * @param chainBefore - The snapshot chain as read before convergence ran.
 * @param witness - The database's word on the request's targets, before and after this boot.
 * @returns What to record, or why nothing can be.
 */
export function reconcileOpenRequest(
	open: OpenRequest,
	result: ConvergeResult,
	out: string,
	chainBefore: SnapshotChain,
	witness: Witness,
): Reconciliation {
	const parent = parentOf(open);
	if (parent === null) {
		return {
			outcome: 'unknown',
			reason: 'the request does not record the snapshot it was measured against',
		};
	}
	if (chainBefore.head === null) {
		return { outcome: 'unknown', reason: 'the migration directory has no single newest snapshot' };
	}

	// Something was generated since the request was filed. The chain says what; the database, as it
	// stood before this boot, says whether it happened here.
	if (chainBefore.head.id !== parent) {
		const search = findMigrationByHash(out, chainBefore, open.changeHash, parent);
		if (search.status === 'unknown_lineage') {
			return {
				outcome: 'unknown',
				reason: 'the snapshot the request was measured against is no longer in the chain',
			};
		}
		if (search.status === 'found') {
			if (witness.before === 'present') {
				return {
					outcome: 'unknown',
					reason:
						`migration ${search.migration.dir} carries this change, but ${describeTargets(open)} ` +
						'was still in the database before this boot — either the migration never ran here, ' +
						'or the column was added back afterwards',
				};
			}
			return {
				outcome: 'record',
				event: {
					type: 'applied',
					payload: {
						migration: search.migration.dir,
						outsideApproval: true,
						verified: witness.before === 'gone',
					},
				},
			};
		}
		// Not this exact change, but the same drop may have run as part of another — the database says.
		if (witness.before === 'gone') {
			return {
				outcome: 'record',
				event: { type: 'applied', payload: { outsideApproval: true, verified: true } },
			};
		}
		if (witness.before === 'undetermined') {
			return {
				outcome: 'unknown',
				reason:
					'migrations were generated since the request, and the database cannot say whether the ' +
					'change is in effect (a rename on the way, a missing table, or nothing to look for)',
			};
		}
	}

	return decideFromThisBoot(open, result, witness);
}

/**
 * Decides from this boot's result alone, once the chain has nothing more to say. A request that is
 * pending again under another fingerprint is superseded by the new request; one whose change applied
 * just now is applied; one whose change is no longer in the schema is withdrawn.
 *
 * @param open - The request on file.
 * @param result - What this boot's convergence found.
 * @param witness - The database's word, before and after this boot.
 * @returns What to record.
 */
function decideFromThisBoot(
	open: OpenRequest,
	result: ConvergeResult,
	witness: Witness,
): Reconciliation {
	switch (result.status) {
		case 'pending':
			return result.changeHash === open.changeHash
				? { outcome: 'still_open' }
				: {
						outcome: 'record',
						event: { type: 'superseded', payload: { supersededBy: result.changeHash } },
					};
		case 'applied':
			// The request's own change applied with nobody asked: measured again, there was nothing left
			// to decide. Or it went along with other changes. Either way the trail says it happened.
			if (result.changeHash === open.changeHash) {
				return {
					outcome: 'record',
					event: { type: 'applied', payload: { reason: 'nothing_to_decide' } },
				};
			}
			if (witness.after === 'gone') {
				return {
					outcome: 'record',
					event: { type: 'applied', payload: { reason: 'applied_with_other_changes' } },
				};
			}
			return { outcome: 'record', event: { type: 'withdrawn' } };
		case 'no_changes':
			// The schema went back to what the snapshot has. If the target is nonetheless gone, somebody
			// removed it with no migration: the database and the snapshot disagree, and no word fits.
			if (witness.after === 'gone') {
				return {
					outcome: 'unknown',
					reason:
						`${describeTargets(open)} is gone from the database, but no migration removed it and ` +
						'the schema no longer asks for it; the database and the snapshot disagree',
				};
			}
			return { outcome: 'record', event: { type: 'withdrawn' } };
		default:
			// Boot is failing on this result; nothing about the request was resolved.
			return { outcome: 'still_open' };
	}
}
