/**
 * The convergence facade: bring the database in line with the schema through one call. It ties the
 * pieces built so far — `drizzle generate` (compute) → the decode + resolution loop → the layer-2
 * apply oracle — behind injected human seams, so it is fully testable before any API/UI exists.
 *
 * Two decision channels, because `generate` is file-only and cannot see data:
 * - **Structural** (rename vs create) come from drizzle's `missing_hints` → the injected `resolve`.
 * - **Data-loss** (dropping a populated table) is only visible once applied, so the apply oracle
 *   detects it. A table that **vanished** is surfaced to the injected `confirmLoss` and, once
 *   confirmed, exempted on re-apply. A table that **survived but lost rows** is never confirmable —
 *   it is returned as `unexpected_data_loss` (a truncation / bad-rebuild signal) and never exempted.
 *
 * The snapshot only advances when the migration actually commits: `generate` writes the migration to
 * `out` up front, so if the apply is declined or fails, that migration is removed — keeping the
 * snapshot in lockstep with the database.
 *
 * See `docs/convergence-design.md`. This covers solo + team-auto. The audit gate returns `pending`
 * but **also rolls the migration back** (no durable pending ledger exists yet), so it never leaves
 * the snapshot ahead of the database; the full pending lifecycle is a later, contained increment.
 */

import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { applyMigration } from '../apply/index.ts';
import { createGenerateCompute } from './generate.ts';
import { resolveWithDecisions } from './resolution.ts';

import type { DatabaseHandle, Dialect } from '../../dialect/index.ts';
import type { ApplyResult, TableRename, UnexpectedRowLoss } from '../apply/index.ts';
import type { ConvergenceErrorCode, SchemaDecision } from '../envelope/index.ts';
import type { ResolvedOutcome, Resolver } from './types.ts';

/** An apply failure that is not the confirmable data-loss case. */
type ApplyFailure = Exclude<
	Extract<ApplyResult, { success: false }>,
	{ reason: 'unexpected_data_loss' }
>;

/** Confirms (`true`) or declines (`false`) an intended data loss the apply oracle detected. */
export type LossResolver = (loss: UnexpectedRowLoss) => boolean | Promise<boolean>;

/** Options for {@link converge}. */
export interface ConvergeOptions {
	/** The live database handle (from the dialect seam). */
	readonly db: DatabaseHandle;
	/** The target dialect. */
	readonly dialect: Dialect;
	/** Path to the Drizzle schema module (the desired state). */
	readonly schema: string;
	/** Migration/snapshot output dir — a gitignored `.glaze/` cache for solo, a committed dir for team. */
	readonly out: string;
	/** Resolves structural decisions (rename vs create). */
	readonly resolve: Resolver;
	/** Confirms intended data loss (a populated table drop). Absent ⇒ any data loss is declined. */
	readonly confirmLoss?: LossResolver;
	/** `auto` (default) applies when safe; `audit` returns `pending` without applying. */
	readonly gate?: 'auto' | 'audit';
}

/** The outcome of {@link converge}. */
export type ConvergeResult =
	| { readonly status: 'applied'; readonly statements: readonly string[] }
	| { readonly status: 'no_changes' }
	| { readonly status: 'rejected'; readonly decision: SchemaDecision }
	| { readonly status: 'data_loss_declined'; readonly losses: readonly UnexpectedRowLoss[] }
	| { readonly status: 'unexpected_data_loss'; readonly losses: readonly UnexpectedRowLoss[] }
	| { readonly status: 'pending'; readonly statements: readonly string[] }
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
	const { db, dialect, schema, out, resolve, confirmLoss, gate = 'auto' } = options;

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
		// same `out`. Fail closed rather than guess which dir is ours (and misapply/leak the rest).
		sweepNewMigrations(out, priorMigrations);
		return {
			status: 'error',
			code: 'internal',
			detail: 'concurrent convergence detected on the output directory',
		};
	}
	const migrationDir = added[0] as string;
	const statements = readMigrationStatements(migrationDir);

	if (gate === 'audit') {
		// No durable pending ledger exists yet, so audit must not leave the snapshot ahead of the DB:
		// roll the migration back and return the SQL for review only. The next converge regenerates it.
		rmSync(migrationDir, { recursive: true, force: true });
		return { status: 'pending', statements };
	}

	const renamedTables = deriveRenamedTables(renames);
	const result = await applyWithLossConfirmation(
		db,
		dialect,
		statements,
		renamedTables,
		confirmLoss,
	);
	if (result.status !== 'applied') rmSync(migrationDir, { recursive: true, force: true });
	return result;
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
 * @returns The converge result.
 */
async function applyWithLossConfirmation(
	db: DatabaseHandle,
	dialect: Dialect,
	statements: readonly string[],
	renamedTables: readonly TableRename[],
	confirmLoss: LossResolver | undefined,
): Promise<ConvergeResult> {
	const droppedTables: string[] = [];

	// Bounded by the number of tables that could be dropped (at least one confirmed per round).
	for (let round = 0; round <= statements.length; round++) {
		// oxlint-disable-next-line no-await-in-loop
		const result = await applyMigration(db, { statements, dialect, droppedTables, renamedTables });

		if (result.success) return { status: 'applied', statements };
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
 * Derives the table renames the oracle needs from the resolved rename decisions. Only table renames
 * matter — a column rename does not change any table's row count.
 *
 * @param renames - The captured rename resolutions.
 * @returns The table renames (`from` → `to`).
 */
function deriveRenamedTables(renames: readonly CapturedRename[]): TableRename[] {
	return renames
		.filter(
			({ decision }) => decision.type === 'rename_or_create' && decision.entityKind === 'table',
		)
		.map(({ decision, from }) => ({ from: tableName(from), to: tableName(decision.entity) }));
}

/**
 * Extracts the table name (the last slot) from a namespaced entity tuple.
 *
 * @param tuple - An entity identifier tuple (e.g. `['public', 'users']`).
 * @returns The table name.
 */
function tableName(tuple: readonly string[]): string {
	return tuple[tuple.length - 1] ?? '';
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

/**
 * Reads a migration's statements, split on drizzle's `--> statement-breakpoint` markers.
 *
 * @param migrationDir - The migration directory.
 * @returns The statements, in order.
 */
function readMigrationStatements(migrationDir: string): string[] {
	return readFileSync(join(migrationDir, 'migration.sql'), 'utf8')
		.split('--> statement-breakpoint')
		.map((statement) => statement.trim())
		.filter((statement) => statement.length > 0);
}
