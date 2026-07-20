/**
 * Types for the atomic-apply oracle (layer 2). This is the belt-and-suspenders backstop for the
 * data-loss scenarios the targeted checks (layer 1) and drizzle-kit both miss: it applies a
 * migration inside a transaction, verifies real before/after row counts, and rolls back if a table
 * that should have survived unexpectedly lost rows. See CLAUDE.md §7 and
 * `docs/research/drizzle-kit-rc-1.0-sdk.md` §3.
 */

import type { Dialect } from '../../dialect/index.ts';

/** A table renamed by the migration; its rows should carry over from `from` to `to`. */
export interface TableRename {
	/** The table's name before the migration. */
	readonly from: string;
	/** The table's name after the migration. */
	readonly to: string;
}

/** Options for {@link applyMigration}. */
export interface ApplyMigrationOptions {
	/** The migration SQL statements, applied in order within one transaction. */
	readonly statements: readonly string[];
	/** The target dialect; selects introspection and transactional-DDL handling. */
	readonly dialect: Dialect;
	/**
	 * Tables this migration intentionally drops. Row loss for these is expected, so the oracle does
	 * not flag them. (A table that vanishes but is not listed here is treated as unexpected loss.)
	 */
	readonly droppedTables?: readonly string[];
	/**
	 * Tables this migration renames. The oracle matches `from`'s before-count against `to`'s
	 * after-count, so a rename is not mistaken for a table disappearing.
	 */
	readonly renamedTables?: readonly TableRename[];
}

/** A table that lost rows (or disappeared) when it should have survived the migration. */
export interface UnexpectedRowLoss {
	/** The surviving table that lost rows (its pre-migration name). */
	readonly table: string;
	/** The row count before the migration. */
	readonly before: number;
	/** The row count after the migration (`0` if the table disappeared). */
	readonly after: number;
}

/**
 * The outcome of {@link applyMigration}. On any failure the transaction has been **rolled back** —
 * nothing was applied.
 */
export type ApplyResult =
	| {
			/** The migration applied and committed; no unexpected data loss. */
			readonly success: true;
			readonly appliedCount: number;
	  }
	| {
			/** A surviving table unexpectedly lost rows; the migration was rolled back. */
			readonly success: false;
			readonly reason: 'unexpected_data_loss';
			readonly losses: readonly UnexpectedRowLoss[];
	  }
	| {
			/** A migration statement failed; the migration was rolled back. */
			readonly success: false;
			readonly reason: 'statement_error';
			/** The statement that failed. */
			readonly failedStatement: string;
			/** A non-i18n diagnostic (the underlying error text) for logs. */
			readonly detail: string;
	  }
	| {
			/** Capturing the before/after row counts failed; the migration was rolled back. */
			readonly success: false;
			readonly reason: 'verification_error';
			/** A non-i18n diagnostic for logs. */
			readonly detail: string;
	  }
	| {
			/** Begin/commit or another transaction-level failure (e.g. a deferred-FK violation at commit). */
			readonly success: false;
			readonly reason: 'transaction_error';
			/** A non-i18n diagnostic for logs. */
			readonly detail: string;
	  };
