/**
 * The atomic-apply facade. Applies a migration inside a single transaction with a before/after
 * row-count oracle: if any surviving table unexpectedly loses rows, or any statement errors, the
 * whole migration is rolled back and reported — never a partial apply.
 */

import { captureRowCounts, findUnexpectedLosses } from './verification.ts';

import type { DatabaseHandle, Dialect, RawExecutor } from '../../dialect/index.ts';
import type { ApplyMigrationOptions, ApplyResult, UnexpectedRowLoss } from './types.ts';

/** Thrown to roll the transaction back when the oracle detects unexpected row loss. */
class DataLossAbort extends Error {
	readonly losses: readonly UnexpectedRowLoss[];

	constructor(losses: readonly UnexpectedRowLoss[]) {
		super('Unexpected data loss detected; rolling back.');
		this.name = 'DataLossAbort';
		this.losses = losses;
	}
}

/** Thrown to roll the transaction back when a migration statement fails, naming the statement. */
class StatementError extends Error {
	readonly statement: string;
	readonly detail: string;

	constructor(statement: string, detail: string) {
		super(`Migration statement failed: ${detail}`);
		this.name = 'StatementError';
		this.statement = statement;
		this.detail = detail;
	}
}

/** Thrown to roll the transaction back when capturing before/after row counts fails. */
class VerificationError extends Error {
	readonly detail: string;

	constructor(detail: string) {
		super(`Row-count verification failed: ${detail}`);
		this.name = 'VerificationError';
		this.detail = detail;
	}
}

/** Matches a transaction-control command at the start of a (comment-stripped) command string. */
const TRANSACTION_CONTROL = /^\s*(?:begin|commit|end|rollback|savepoint|release)\b/i;

/**
 * Detects a transaction-control command anywhere in a statement — as the first token, after a leading
 * comment, or embedded after a `;` in a compound statement — any of which would hijack the apply's own
 * transaction and break atomicity. String literals and quoted identifiers are blanked first so a `;`
 * or keyword inside them cannot cause a (fail-closed but annoying) false positive.
 *
 * @param statement - A single migration statement.
 * @returns `true` when a transaction-control command is present.
 */
function hasTransactionControl(statement: string): boolean {
	const sanitized = statement
		.replaceAll(/--[^\n]*/g, ' ')
		.replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
		.replaceAll(/'(?:[^']|'')*'/g, "''")
		.replaceAll(/"(?:[^"]|"")*"/g, '""');
	return sanitized.split(';').some((command) => TRANSACTION_CONTROL.test(command));
}

/**
 * Applies a migration atomically and verifies it did not silently lose data.
 *
 * Runs entirely inside one transaction: capture row counts → run statements → re-capture → if a
 * surviving (non-dropped, non-renamed) table lost rows, roll back. Any failure leaves the database
 * untouched.
 *
 * @param handle - The dialect seam handle providing the transaction.
 * @param options - The statements, dialect, and drop/rename context.
 * @returns The outcome; on failure the transaction was rolled back.
 */
export async function applyMigration(
	handle: DatabaseHandle,
	options: ApplyMigrationOptions,
): Promise<ApplyResult> {
	const { statements, dialect, droppedTables = [], renamedTables = [] } = options;
	const dropped = new Set(droppedTables);

	try {
		const appliedCount = await handle.transaction(async (tx) => {
			await prepareTransaction(tx, dialect);

			const before = await captureVerified(tx, dialect);
			await runStatements(tx, statements);
			const after = await captureVerified(tx, dialect);

			const losses = findUnexpectedLosses(before, after, dropped, renamedTables);
			if (losses.length > 0) throw new DataLossAbort(losses);

			return statements.length;
		});

		return { success: true, appliedCount };
	} catch (error) {
		return toFailure(error);
	}
}

/**
 * Applies transaction-scoped settings before the migration runs. On SQLite, `PRAGMA defer_foreign_keys
 * = ON` lets the drizzle-kit table-rebuild dance (drop + recreate) proceed without tripping FK checks
 * mid-transaction.
 *
 * NOTE: this only **defers** checks that would otherwise fire — it does not enable FK enforcement, and
 * `bun:sqlite`/`better-sqlite3` default `PRAGMA foreign_keys` OFF, so no FK integrity is actually
 * enforced at commit today. Turning enforcement on (and validating it against drizzle's rebuild
 * output) is a tracked follow-up; the **row-count oracle**, not FK enforcement, is the data-loss
 * guarantee here.
 *
 * @param tx - The transaction-bound executor.
 * @param dialect - The target dialect.
 */
async function prepareTransaction(tx: RawExecutor, dialect: Dialect): Promise<void> {
	if (dialect === 'sqlite') {
		await tx('PRAGMA defer_foreign_keys = ON');
	}
}

/**
 * Captures row counts, tagging any failure as a {@link VerificationError} so it is not mistaken for
 * a statement failure.
 *
 * @param tx - The transaction-bound executor.
 * @param dialect - The target dialect.
 * @returns Row counts by table.
 * @throws {VerificationError} When capture fails.
 */
async function captureVerified(tx: RawExecutor, dialect: Dialect): Promise<Map<string, number>> {
	try {
		return await captureRowCounts(tx, dialect);
	} catch (error) {
		throw new VerificationError(error instanceof Error ? error.message : String(error));
	}
}

/**
 * Runs each statement in order, rejecting transaction-control statements (which would break the
 * apply's own transaction) and wrapping any failure so the offending statement is reported.
 *
 * @param tx - The transaction-bound executor.
 * @param statements - The statements to run.
 * @throws {StatementError} When a statement is transaction-control or fails.
 */
async function runStatements(tx: RawExecutor, statements: readonly string[]): Promise<void> {
	for (const statement of statements) {
		if (hasTransactionControl(statement)) {
			throw new StatementError(
				statement,
				'transaction-control statements are not allowed in a migration',
			);
		}
		try {
			// Sequential by design: a migration's statements must apply in order.
			// oxlint-disable-next-line no-await-in-loop
			await tx(statement);
		} catch (error) {
			throw new StatementError(statement, error instanceof Error ? error.message : String(error));
		}
	}
}

/**
 * Maps a thrown error to the appropriate failure result. The transaction has already rolled back by
 * the time this runs.
 *
 * @param error - The error thrown inside the transaction.
 * @returns The failure result.
 */
function toFailure(error: unknown): ApplyResult {
	if (error instanceof DataLossAbort) {
		return { success: false, reason: 'unexpected_data_loss', losses: error.losses };
	}
	if (error instanceof StatementError) {
		return {
			success: false,
			reason: 'statement_error',
			failedStatement: error.statement,
			detail: error.detail,
		};
	}
	if (error instanceof VerificationError) {
		return { success: false, reason: 'verification_error', detail: error.detail };
	}

	// Begin/commit or another transaction-level failure (e.g. a deferred-FK violation at commit).
	return {
		success: false,
		reason: 'transaction_error',
		detail: error instanceof Error ? error.message : String(error),
	};
}
