/**
 * The convergence facade: bring the database in line with the schema through one call. It ties the
 * pieces built so far — `drizzle generate` (compute) → the decode + resolution loop → the layer-2
 * apply oracle — behind injected human seams, so it is fully testable before any API/UI exists.
 *
 * Deciding happens **once, before anything runs**, over the whole diff:
 * - **Structural** decisions (rename vs create) come from drizzle's `missing_hints` → the injected
 *   `resolve`, because a migration cannot be generated until they are answered.
 * - The **classifier** then reads the snapshot diff and sorts every operation: additive applies;
 *   destructive is measured against the live database, and only a measurement that finds something
 *   (a populated column or table drop) becomes a decision; unclassified — no rule — always does. A
 *   change the database would itself reject (`NOT NULL` over existing nulls) is a hard block, in
 *   either mode: there is nothing to say yes to.
 * - A decision goes to a person: with `audit`, the change is returned as `pending` and recorded for
 *   the admin screen; without it, the injected `confirmDrop` / `confirmUnclassified` seams ask at the
 *   terminal.
 * - The **layer-2 apply oracle** then verifies, never decides: a table that vanished without having
 *   been decided on goes to `confirmLoss`; a table that **survived but lost rows** is never
 *   confirmable — it is `unexpected_data_loss` (a truncation / bad-rebuild signal).
 *
 * The snapshot only advances when the migration actually commits: `generate` writes the migration to
 * `out` up front, so if the apply is declined, pending or failed, that migration is removed —
 * keeping the snapshot in lockstep with the database.
 *
 * See `specs/design/convergence.md` and `specs/design/pending-approvals.md`.
 */

import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { applyMigration } from '../apply/index.ts';
import { readMigrationStatements } from './chain.ts';
import { createGenerateCompute } from './generate.ts';
import { computeChangeHash, readParentSnapshotId } from './hash.ts';
import { runPreflight } from './preflight.ts';
import { resolveWithDecisions } from './resolution.ts';

import type { DatabaseHandle, Dialect } from '../../dialect/index.ts';
import type { ApplyResult, TableRename, UnexpectedRowLoss } from '../apply/index.ts';
import type {
	ColumnRename,
	Operation,
	Renames,
	TableRename as ClassifierTableRename,
} from '../classifier/index.ts';
import type { ConvergenceErrorCode, SchemaDecision } from '../envelope/index.ts';
import type { DataLossFinding } from '../safety/index.ts';
import type { ResolvedOutcome, Resolver } from './types.ts';

/** An apply failure that is not the confirmable data-loss case. */
type ApplyFailure = Exclude<
	Extract<ApplyResult, { success: false }>,
	{ reason: 'unexpected_data_loss' }
>;

/** Confirms (`true`) or declines (`false`) an intended data loss the apply oracle detected. */
export type LossResolver = (loss: UnexpectedRowLoss) => boolean | Promise<boolean>;

/**
 * Confirms (`true`) or declines (`false`) a destructive-but-valid change the measurement flagged — a
 * populated column or table drop. The finding carries the target and the affected row count.
 */
export type DropConfirmer = (finding: DataLossFinding) => boolean | Promise<boolean>;

/**
 * Confirms (`true`) or declines (`false`) an operation the classifier has no rule for. Glaze cannot
 * say whether it destroys data; the person can, so they are also shown the SQL it is part of.
 */
export type UnclassifiedConfirmer = (
	operation: Operation,
	statements: readonly string[],
) => boolean | Promise<boolean>;

/** Options for {@link converge}. */
export interface ConvergeOptions {
	/** The live database handle (from the dialect seam). */
	readonly db: DatabaseHandle;
	/** The target dialect. */
	readonly dialect: Dialect;
	/** Path to the Drizzle schema module (the desired state). */
	readonly schema: string;
	/**
	 * Migration/snapshot output dir. Must **persist across restarts** (a committed directory) so the
	 * snapshot chain stays in lockstep with the database — if it is lost/gitignored, a later boot
	 * re-`generate`s a `CREATE` for tables that already exist. A per-mode gitignored `.glaze/` cache
	 * (self-healed via a drizzle `pull` re-baseline) is a future increment; today both modes use this.
	 */
	readonly out: string;
	/** Resolves structural decisions (rename vs create). */
	readonly resolve: Resolver;
	/**
	 * Confirms a table loss the apply oracle found that nobody decided on beforehand. Absent ⇒ declined.
	 * A populated table drop the classifier saw coming goes to `confirmDrop` instead.
	 */
	readonly confirmLoss?: LossResolver;
	/** Confirms a measured, destructive-but-valid change (a populated column or table drop). Absent ⇒ declined. */
	readonly confirmDrop?: DropConfirmer;
	/** Confirms an operation the classifier cannot sort. Absent ⇒ declined. */
	readonly confirmUnclassified?: UnclassifiedConfirmer;
	/**
	 * Where a change that needs a person is answered: `true` returns it as `pending` for the admin
	 * screen, `false` asks the terminal seams. An additive change applies either way.
	 * @default false
	 */
	readonly audit?: boolean;
}

/** The outcome of {@link converge}. */
export type ConvergeResult =
	| {
			readonly status: 'applied';
			readonly statements: readonly string[];
			/** Fingerprint of what applied, so boot can match it against a request on file. */
			readonly changeHash: string;
	  }
	| { readonly status: 'no_changes' }
	| { readonly status: 'rejected'; readonly decision: SchemaDecision }
	| { readonly status: 'data_loss_declined'; readonly losses: readonly UnexpectedRowLoss[] }
	| { readonly status: 'unexpected_data_loss'; readonly losses: readonly UnexpectedRowLoss[] }
	| { readonly status: 'unsafe_change'; readonly findings: readonly DataLossFinding[] }
	| { readonly status: 'drop_declined'; readonly findings: readonly DataLossFinding[] }
	| { readonly status: 'unclassified_change'; readonly operations: readonly Operation[] }
	| {
			readonly status: 'pending';
			readonly statements: readonly string[];
			/** Fingerprint of this change; the dedupe key at boot and the guard at approval. */
			readonly changeHash: string;
			/** The snapshot the change was measured against; where reconciliation starts reading from. */
			readonly parentSnapshotId: string;
			/** What the measurement found in the live database — the row counts a person is shown. */
			readonly findings: readonly DataLossFinding[];
			/** The operations Glaze has no rule for — pending because they are unknown, not destructive. */
			readonly unclassified: readonly Operation[];
	  }
	| { readonly status: 'error'; readonly code: ConvergenceErrorCode; readonly detail?: string };

/** A resolved rename, captured so the apply oracle can match the table across the rename. */
interface CapturedRename {
	readonly decision: SchemaDecision;
	readonly from: readonly string[];
}

/**
 * Converges the database to the schema: computes the diff, resolves any decisions, and applies it
 * atomically through the oracle.
 *
 * @param options - The database, dialect, schema, output dir, and injected human seams.
 * @returns What happened — applied, nothing to do, a rejected/declined decision, pending, or an error.
 */
export async function converge(options: ConvergeOptions): Promise<ConvergeResult> {
	const {
		db,
		dialect,
		schema,
		out,
		resolve,
		confirmLoss,
		confirmDrop,
		confirmUnclassified,
		audit = false,
	} = options;

	const renames: CapturedRename[] = [];
	const recordingResolve: Resolver = async (decision) => {
		const resolution = await resolve(decision);
		if (resolution.action === 'rename') renames.push({ decision, from: resolution.from });
		return resolution;
	};

	const priorMigrations = listMigrationDirs(out);
	const outcome = await resolveWithDecisions(
		createGenerateCompute({ dialect, schema, out }),
		recordingResolve,
	);
	if (outcome.status !== 'ok') {
		// Defensive: `generate` should not write on a non-`ok` result, but if it ever did, that dir
		// would advance the snapshot without an apply — sweep any new migration to stay in lockstep.
		sweepNewMigrations(out, priorMigrations);
		return fromNonOk(outcome);
	}

	// `ok` means generate wrote exactly one new migration; it advances the snapshot on commit only.
	const added = newMigrationDirs(out, priorMigrations);
	if (added.length === 0) return { status: 'no_changes' };
	if (added.length > 1) {
		// generate writes exactly one migration; more than one means a concurrent converge raced on the
		// same `out`. Fail closed WITHOUT sweeping — we cannot tell which dir is ours, and deleting a
		// peer's (possibly already-applied) migration would regress the snapshot below the DB. Leave
		// them for the operator / a future `out` lock to reconcile.
		return {
			status: 'error',
			code: 'internal',
			detail: 'concurrent convergence detected on the output directory',
		};
	}
	const migrationDir = added[0] as string;

	// Everything past here can throw — a filesystem error, or an injected confirmer that rejects. A
	// throw must not leave the migration dir behind (that would advance the snapshot with nothing
	// applied), so sweep it and return a typed error rather than an uncaught rejection. Ctrl+C at the
	// confirmation prompt arrives as the prompt closing, which declines and lands here too. A process
	// killed outright can still leave the directory; boot reconciliation checks the live database
	// before believing one.
	try {
		const statements = readMigrationStatements(migrationDir);
		const result = await decideAndApply({
			db,
			dialect,
			statements,
			renames: {
				tables: deriveRenamedTables(renames),
				columns: deriveRenamedColumns(renames),
			},
			migrationDir,
			out,
			audit,
			confirmLoss,
			confirmDrop,
			confirmUnclassified,
		});
		// Only a commit advances the snapshot. Pending included: the approval regenerates the change.
		if (result.status !== 'applied') rmSync(migrationDir, { recursive: true, force: true });
		return result;
	} catch (error) {
		rmSync(migrationDir, { recursive: true, force: true });
		return {
			status: 'error',
			code: 'internal',
			detail: error instanceof Error ? error.message : String(error),
		};
	}
}

/** Everything {@link decideAndApply} needs to classify, measure and apply one freshly-generated migration. */
interface DecideAndApplyArgs {
	readonly db: DatabaseHandle;
	readonly dialect: Dialect;
	readonly statements: readonly string[];
	readonly renames: Renames;
	readonly migrationDir: string;
	readonly out: string;
	readonly audit: boolean;
	readonly confirmLoss: LossResolver | undefined;
	readonly confirmDrop: DropConfirmer | undefined;
	readonly confirmUnclassified: UnclassifiedConfirmer | undefined;
}

/**
 * The one decision path, audited or not. Classify and measure; block what the database would refuse;
 * apply what needs nobody; hand what needs a person to the screen (`pending`) or the terminal seams.
 * The caller rolls the snapshot back on anything but `applied`.
 *
 * @param args - The database, dialect, migration, renames, mode and the injected seams.
 * @returns The converge result.
 */
async function decideAndApply(args: DecideAndApplyArgs): Promise<ConvergeResult> {
	const { db, dialect, statements, renames, migrationDir, out, audit } = args;

	const preflight = await runPreflight((sql) => db.raw(sql), dialect, migrationDir, out, renames);
	if (preflight.status === 'error') {
		return { status: 'error', code: 'internal', detail: preflight.detail };
	}
	const { findings, classification } = preflight;
	const { unclassified } = classification;

	// A blocking finding is one the database itself would reject. `audit` decides WHO says yes, never
	// WHETHER the rule applies: filing it as a pending approval would put an approve button on a change
	// that can never succeed, and turn a clean refusal into a mid-migration failure later.
	if (findings.some((finding) => !isConfirmable(finding))) {
		return { status: 'unsafe_change', findings };
	}

	// The fingerprint names the change and the snapshot it was measured against; boot reconciles a
	// request it filed by looking for exactly this pair in the chain later.
	const parentSnapshotId = readParentSnapshotId(migrationDir);
	const changeHash = computeChangeHash(statements, parentSnapshotId);

	const needsPerson = findings.length > 0 || unclassified.length > 0;
	if (needsPerson && audit) {
		// The measurements are live row counts, read before the rollback: they are what the approver
		// is shown, and once the migration dir is gone there is no snapshot to diff against.
		return { status: 'pending', statements, changeHash, parentSnapshotId, findings, unclassified };
	}
	if (needsPerson) {
		if (!(await allDropsConfirmed(findings, args.confirmDrop))) {
			return { status: 'drop_declined', findings };
		}
		if (!(await allUnclassifiedConfirmed(unclassified, statements, args.confirmUnclassified))) {
			return { status: 'unclassified_change', operations: unclassified };
		}
	}

	// The apply oracle counts `public` only and knows tables by bare name, so it is told only about
	// what it can see: a rename or a decided drop in another schema would otherwise read as a
	// same-named public table vanishing.
	const decidedDrops = findings
		.map((finding) => finding.change)
		.filter((change) => change.kind === 'drop_table' && isVisibleToOracle(change.schema))
		.map((change) => change.table);
	const visibleRenames = renames.tables
		.filter((rename) => isVisibleToOracle(rename.schema))
		.map(({ from, to }) => ({ from, to }));
	const applied = await applyWithLossConfirmation(
		db,
		dialect,
		statements,
		visibleRenames,
		args.confirmLoss,
		decidedDrops,
	);
	return applied.status === 'applied' ? { ...applied, changeHash } : applied;
}

/**
 * Whether the apply oracle can see a table: it counts `public` only (SQLite has no schemas).
 *
 * @param schema - The table's schema, or `undefined` on SQLite.
 * @returns `true` when the oracle counts that table.
 */
function isVisibleToOracle(schema: string | undefined): boolean {
	return schema === undefined || schema === 'public';
}

/** The findings a person may agree to: valid SQL that destroys data, so a decision. */
const CONFIRMABLE_CODES: ReadonlySet<DataLossFinding['code']> = new Set([
	'column_has_data',
	'table_has_rows',
	// drizzle narrows with `USING "c"::varchar(n)`, and Postgres truncates under an explicit cast
	// rather than refusing — so this destroys data silently, like a drop.
	'column_length_overflow',
]);

/**
 * Whether a finding is one a person may agree to. A populated column or table drop, or a narrowing
 * over longer values, is: valid SQL that destroys data, so it is a decision. Every other code
 * describes a change the database would refuse outright, which is not a decision anybody can take.
 *
 * @param finding - A measurement finding.
 * @returns `true` when the finding can be confirmed rather than blocked.
 */
function isConfirmable(finding: DataLossFinding): boolean {
	return CONFIRMABLE_CODES.has(finding.code);
}

/**
 * Asks the terminal seam about each confirmable finding. Each must be individually confirmed; an
 * absent confirmer declines.
 *
 * @param findings - The measurement findings, all confirmable.
 * @param confirmDrop - The injected drop confirmer; absent ⇒ decline.
 * @returns `true` only when every finding is confirmed.
 */
async function allDropsConfirmed(
	findings: readonly DataLossFinding[],
	confirmDrop: DropConfirmer | undefined,
): Promise<boolean> {
	for (const finding of findings) {
		// oxlint-disable-next-line no-await-in-loop
		const confirmed = confirmDrop ? await confirmDrop(finding) : false;
		if (!confirmed) return false;
	}
	return true;
}

/**
 * Asks the terminal seam about each unclassified operation. An absent confirmer declines.
 *
 * @param operations - The operations the classifier has no rule for.
 * @param statements - The migration's SQL, shown alongside.
 * @param confirm - The injected confirmer; absent ⇒ decline.
 * @returns `true` only when every operation is confirmed.
 */
async function allUnclassifiedConfirmed(
	operations: readonly Operation[],
	statements: readonly string[],
	confirm: UnclassifiedConfirmer | undefined,
): Promise<boolean> {
	for (const operation of operations) {
		// oxlint-disable-next-line no-await-in-loop
		const confirmed = confirm ? await confirm(operation, statements) : false;
		if (!confirmed) return false;
	}
	return true;
}

/**
 * Maps a non-`ok` resolution outcome to a converge result.
 *
 * @param outcome - A resolution outcome that is not `ok`.
 * @returns The corresponding converge result.
 */
function fromNonOk(outcome: Exclude<ResolvedOutcome, { status: 'ok' }>): ConvergeResult {
	switch (outcome.status) {
		case 'no_changes':
			return { status: 'no_changes' };
		case 'rejected':
			return { status: 'rejected', decision: outcome.decision };
		case 'unresolved':
			return { status: 'error', code: 'invalid_hints', detail: 'decisions were left unresolved' };
		case 'error':
			return outcome.detail === undefined
				? { status: 'error', code: outcome.code }
				: { status: 'error', code: outcome.code, detail: outcome.detail };
		default: {
			const unexpected: never = outcome;
			throw new Error(`Unexpected resolution outcome: ${JSON.stringify(unexpected)}`);
		}
	}
}

/**
 * Applies the migration, re-applying with any confirmed data loss exempted, until it commits or a
 * loss is declined / a non-loss error occurs. Each attempt is atomic (the oracle rolls back on
 * detected loss), so re-application starts from the same database state.
 *
 * @param db - The database handle.
 * @param dialect - The target dialect.
 * @param statements - The migration statements.
 * @param renamedTables - Tables renamed by this migration (from resolved rename decisions).
 * @param confirmLoss - Confirms intended data loss; absent ⇒ decline.
 * @param decidedDrops - Tables whose drop a person already decided on; the oracle verifies, not asks.
 * @returns The converge result.
 */
async function applyWithLossConfirmation(
	db: DatabaseHandle,
	dialect: Dialect,
	statements: readonly string[],
	renamedTables: readonly TableRename[],
	confirmLoss: LossResolver | undefined,
	decidedDrops: readonly string[],
): Promise<ConvergeResult> {
	const droppedTables: string[] = [...decidedDrops];

	// Bounded by the number of tables that could be dropped (at least one confirmed per round).
	for (let round = 0; round <= statements.length; round++) {
		// oxlint-disable-next-line no-await-in-loop
		const result = await applyMigration(db, { statements, dialect, droppedTables, renamedTables });

		if (result.success) return { status: 'applied', statements, changeHash: '' };
		if (result.reason !== 'unexpected_data_loss') return fromApplyFailure(result);

		// A surviving table that lost rows is never a confirmable drop — it signals a truncation or a
		// bad rebuild. Fail closed: surface it as unexpected loss and never exempt it (the oracle has
		// already rolled the migration back).
		if (result.losses.some((loss) => !loss.vanished)) {
			return { status: 'unexpected_data_loss', losses: result.losses };
		}

		for (const loss of result.losses) {
			// oxlint-disable-next-line no-await-in-loop
			const confirmed = confirmLoss ? await confirmLoss(loss) : false;
			if (!confirmed) return { status: 'data_loss_declined', losses: result.losses };
			droppedTables.push(loss.table);
		}
	}

	return { status: 'error', code: 'internal', detail: 'too many data-loss confirmation rounds' };
}

/**
 * Maps a non-data-loss apply failure to a converge result, preserving the failing statement and the
 * failure kind (a verification failure is a Glaze-internal fault, not a user query error).
 *
 * @param failure - A rolled-back apply failure other than `unexpected_data_loss`.
 * @returns The corresponding converge error result.
 */
function fromApplyFailure(failure: ApplyFailure): ConvergeResult {
	switch (failure.reason) {
		case 'statement_error':
			return {
				status: 'error',
				code: 'query_error',
				detail: `${failure.detail} (failed statement: ${failure.failedStatement})`,
			};
		case 'transaction_error':
			return {
				status: 'error',
				code: 'query_error',
				detail: `transaction failed: ${failure.detail}`,
			};
		case 'verification_error':
			return {
				status: 'error',
				code: 'internal',
				detail: `row-count verification failed: ${failure.detail}`,
			};
		default: {
			const unexpected: never = failure;
			throw new Error(`Unexpected apply failure: ${JSON.stringify(unexpected)}`);
		}
	}
}

/**
 * Derives the table renames from the resolved rename decisions, with the schema each lives in, so a
 * rename in one Postgres schema cannot be mistaken for a same-named table in another. The apply
 * oracle takes the same pairs without the schema.
 *
 * @param renames - The captured rename resolutions.
 * @returns The table renames (`from` → `to`), with their schema when the tuple carries one.
 */
function deriveRenamedTables(renames: readonly CapturedRename[]): ClassifierTableRename[] {
	return renames
		.filter(
			({ decision }) => decision.type === 'rename_or_create' && decision.targetKind === 'table',
		)
		.map(({ decision, from }) => ({
			...schemaSlot(decision.target, 2),
			from: tableName(from),
			to: tableName(decision.target),
		}));
}

/**
 * The schema slot of a target tuple, when the tuple is long enough to carry one.
 *
 * @param tuple - The target tuple (`[schema, table]` or `[schema, table, column]`).
 * @param length - The tuple length that carries a schema for this kind.
 * @returns `{ schema }`, or nothing.
 */
function schemaSlot(tuple: readonly string[], length: number): { schema?: string } {
	const schema = tuple.length >= length ? tuple[0] : undefined;
	return schema ? { schema } : {};
}

/**
 * Extracts the table name (the last slot) from a namespaced target tuple.
 *
 * @param tuple - An target identifier tuple (e.g. `['public', 'users']`).
 * @returns The table name.
 */
function tableName(tuple: readonly string[]): string {
	return tuple[tuple.length - 1] ?? '';
}

/**
 * Derives the column renames layer-1 pre-flight needs from the resolved rename decisions, so a renamed
 * column is not re-derived as a `drop_column` (its data carries across the rename). Only column-kind
 * renames apply. This is the "use drizzle's decision rather than re-infer it" path.
 *
 * @param renames - The captured rename resolutions.
 * @returns The column renames (`table`, `from` → `to`), skipping any with an incomplete tuple.
 */
function deriveRenamedColumns(renames: readonly CapturedRename[]): ColumnRename[] {
	return renames
		.filter(
			({ decision }) => decision.type === 'rename_or_create' && decision.targetKind === 'column',
		)
		.map(({ decision, from }) => ({
			...schemaSlot(decision.target, 3),
			table: tableSlot(decision.target),
			from: tableName(from),
			to: tableName(decision.target),
		}))
		.filter((rename) => rename.table !== '' && rename.from !== '' && rename.to !== '');
}

/**
 * Extracts the table name (the second-to-last slot) from a column target tuple `[…, table, column]`.
 *
 * @param tuple - A column target identifier tuple (e.g. `['public', 'users', 'handle']`).
 * @returns The table name, or `''` when the tuple is too short.
 */
function tableSlot(tuple: readonly string[]): string {
	return tuple[tuple.length - 2] ?? '';
}

/**
 * Lists the migration directory names in `out`, or `[]` when `out` does not yet exist.
 *
 * @param out - The migration output directory.
 * @returns The migration directory names.
 */
function listMigrationDirs(out: string): string[] {
	try {
		return readdirSync(out, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
}

/**
 * Lists the migration directories generate added (those not present beforehand), as full paths.
 *
 * @param out - The migration output directory.
 * @param prior - The migration directory names present before generate ran.
 * @returns The newly-added migrations' paths, sorted (normally exactly one).
 */
function newMigrationDirs(out: string, prior: readonly string[]): string[] {
	return listMigrationDirs(out)
		.filter((name) => !prior.includes(name))
		.toSorted()
		.map((name) => join(out, name));
}

/**
 * Removes every migration directory generate added since `prior`, rolling the snapshot back to where
 * it was (the snapshot lives inside each migration dir, so removing the dir reverts it).
 *
 * @param out - The migration output directory.
 * @param prior - The migration directory names present before generate ran.
 * @returns Nothing.
 */
function sweepNewMigrations(out: string, prior: readonly string[]): void {
	for (const dir of newMigrationDirs(out, prior)) {
		rmSync(dir, { recursive: true, force: true });
	}
}
