/**
 * Data-safety types for convergence.
 *
 * These describe schema changes that a database will **reject at apply time** when existing data
 * conflicts — and which drizzle-kit does **not** surface as `confirm_data_loss` decisions (verified
 * against drizzle-kit 1.0.0-rc.4: e.g. `SET NOT NULL` over existing NULLs is emitted and fails as a
 * runtime `query_error`). Glaze detects them **before** applying so the change becomes a clean,
 * translatable decision instead of a mid-migration failure. See
 * `docs/research/drizzle-kit-rc-1.0-sdk.md` §3.
 *
 * This is a data-safety gate, so it **fails closed**: when a probe cannot determine safety (a
 * missing object, an unreadable result, a bad descriptor), it reports `could_not_verify` — never a
 * silent "safe."
 */

/**
 * Runs a read-only SQL statement and returns its result rows. Matches the dialect seam's
 * {@link DatabaseHandle.raw}, so the detector is dialect-agnostic — the same COUNT/GROUP BY probes
 * run on Postgres and SQLite without branching.
 *
 * @param sql - The SQL text to execute. The detector only ever passes SELECTs built from validated,
 *   quoted identifiers and integer literals — never interpolated row values.
 * @returns The rows produced by the statement.
 */
export type QueryExecutor = (sql: string) => Promise<Array<Record<string, unknown>>>;

/**
 * Every stable, translatable data-loss reason, as a runtime tuple. The union {@link DataLossCode} is
 * derived from it, so the codes have a single source of truth and can also be enumerated at runtime
 * (e.g. to assert every code has an i18n message). Surfaced to the Admin UI, which owns the wording.
 *
 * - `not_null_existing_nulls` — a column gaining `NOT NULL` has existing NULL rows.
 * - `not_null_column_non_empty` — a new `NOT NULL` column without a default on a non-empty table.
 * - `unique_duplicates` — a new `UNIQUE` constraint but duplicate values already exist.
 * - `column_length_overflow` — a column's length is narrowed below values that already exist.
 * - `could_not_verify` — the gate could not determine safety; treat as unsafe (fail closed).
 */
export const DATA_LOSS_CODES = [
	'not_null_existing_nulls',
	'not_null_column_non_empty',
	'unique_duplicates',
	'column_length_overflow',
	'could_not_verify',
] as const;

/** A stable, translatable reason a change is unsafe (or unverifiable). Derived from {@link DATA_LOSS_CODES}. */
export type DataLossCode = (typeof DATA_LOSS_CODES)[number];

/**
 * A proposed schema change the detector knows how to probe. A discriminated union on `kind` — each
 * variant carries exactly the identifiers its probe needs. Produced later from the drizzle-kit
 * snapshot diff. `table`/`column` are single (unqualified) identifiers, quoted safely at probe time.
 */
export type UnsafeChange =
	| {
			/** `ALTER COLUMN … SET NOT NULL` on an existing column. */
			readonly kind: 'set_not_null';
			readonly table: string;
			readonly column: string;
	  }
	| {
			/** `ADD COLUMN … NOT NULL` on an existing table. */
			readonly kind: 'add_not_null_column';
			readonly table: string;
			readonly column: string;
			/** Whether the new column supplies a `DEFAULT`; a non-NULL default makes the add safe. */
			readonly hasDefault: boolean;
	  }
	| {
			/**
			 * `ADD … UNIQUE (column)` — single-column uniqueness. The probe groups by the column, so it
			 * respects the column's **declared collation** (a `citext` / `COLLATE NOCASE` column detects
			 * case-insensitive collisions; a binary column does not). See {@link checkUniqueOnDuplicates}.
			 */
			readonly kind: 'add_unique';
			readonly table: string;
			readonly column: string;
			/**
			 * `UNIQUE NULLS NOT DISTINCT` (Postgres 15+): two or more NULLs also violate the constraint.
			 * Defaults to `false` (the SQL default, where multiple NULLs are allowed).
			 */
			readonly nullsNotDistinct?: boolean;
	  }
	| {
			/**
			 * Narrowing a column's max length (e.g. `varchar(255)` → `varchar(10)`). Only enforced on
			 * Postgres; SQLite ignores column length, so this is a no-op there.
			 */
			readonly kind: 'narrow_column';
			readonly table: string;
			readonly column: string;
			/** The new maximum length. Must be a non-negative integer. */
			readonly maxLength: number;
	  };

/**
 * A change that is unsafe against the live database, or that the gate could not verify.
 *
 * `affectedRows` is the count of offending rows when the probe measured them, and `null` when the
 * count is unknown — which is exactly the `could_not_verify` case. `detail` is a non-translated
 * diagnostic (e.g. the underlying DB error) for logs; the UI renders `code`, not `detail`.
 */
export interface DataLossFinding {
	/** The change that is unsafe or unverifiable. */
	readonly change: UnsafeChange;
	/** The stable, translatable reason. */
	readonly code: DataLossCode;
	/** How many existing rows violate the change, or `null` when unknown (`could_not_verify`). */
	readonly affectedRows: number | null;
	/** Optional non-i18n diagnostic (e.g. the DB error text) — for logs, never for display. */
	readonly detail?: string;
}
