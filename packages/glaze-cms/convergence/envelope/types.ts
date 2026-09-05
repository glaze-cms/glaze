/**
 * Glaze's convergence result model — the clean, translatable signal the Admin UI and collaboration
 * WebSocket consume. It is decoded from drizzle-kit's raw `--output json` / SDK envelope (see
 * `specs/research/drizzle-kit-rc-1.0-sdk.md` §2–3) so Glaze's surface stays decoupled from drizzle's
 * exact (rc-versioned) shapes: the UI translates a Glaze `code`, never a scraped string.
 */

/**
 * Glaze's stable, i18n-mappable convergence error codes. Derived from the tuple so they can also be
 * enumerated at runtime (e.g. to assert every code has a translation). drizzle's `error.code` is an
 * open string; unmapped codes fall back to `unknown`.
 */
export const CONVERGENCE_ERROR_CODES = [
	'config_invalid',
	'config_not_found',
	'schema_not_found',
	'missing_params',
	'ambiguous_params',
	'connection_error',
	'driver_error',
	'packages_missing',
	'query_error',
	'unsupported_change',
	'invalid_hints',
	'check_failed',
	'migrations_outdated',
	'orm_version',
	'internal',
	'unknown',
] as const;

/** A Glaze convergence error code. Derived from {@link CONVERGENCE_ERROR_CODES}. */
export type ConvergenceErrorCode = (typeof CONVERGENCE_ERROR_CODES)[number];

/** Why a destructive change needs confirmation (from drizzle's `confirm_data_loss` reason). */
export type DataLossReason = 'non_empty' | 'table_recreate' | 'type_change';

/**
 * A decision a human must resolve before a schema change can proceed — the payload the collaboration
 * WebSocket surfaces to a non-technical approver. Decoded from drizzle's `missing_hints.unresolved`.
 */
export type SchemaDecision =
	| {
			/** The diff is ambiguous: the new entity could be a rename of a deleted one, or a create. */
			readonly type: 'rename_or_create';
			/** The entity kind (`table`, `column`, …) as drizzle reports it. */
			readonly entityKind: string;
			/** The entity's namespaced identifier tuple (e.g. `['public', 'users', 'handle']`). */
			readonly entity: readonly string[];
	  }
	| {
			/** The change would drop or rewrite data and needs explicit confirmation. */
			readonly type: 'confirm_data_loss';
			readonly entityKind: string;
			readonly entity: readonly string[];
			/**
			 * Why confirmation is required. `'unknown'` when drizzle sent a reason Glaze doesn't
			 * recognize (a future rc) — surfaced honestly, never relabeled as a known reason.
			 */
			readonly reason: DataLossReason | 'unknown';
			/** For `type_change`, the old and new SQL types. */
			readonly reasonDetails?: { readonly from: string; readonly to: string };
	  };

/**
 * The outcome of a convergence operation (`generate` / `push`), normalized from drizzle's envelope.
 */
export type OperationResult =
	| {
			/** The operation succeeded. `statements` carries emitted SQL when available (export/explain). */
			readonly status: 'ok';
			readonly statements: readonly string[];
			/** The written migration path, when the operation wrote one (generate). */
			readonly migrationPath?: string;
			/** Advisory "this is destructive" warnings drizzle emitted (export/explain); shown in the preview. */
			readonly warnings?: readonly string[];
	  }
	| {
			/** The schema already matches; nothing to do. */
			readonly status: 'no_changes';
	  }
	| {
			/** Human decisions are required before proceeding — surfaced to the approver. */
			readonly status: 'needs_decision';
			readonly decisions: readonly SchemaDecision[];
	  }
	| {
			/** The operation failed. `code` is the translatable Glaze code; `rawCode` is drizzle's. */
			readonly status: 'error';
			readonly code: ConvergenceErrorCode;
			readonly rawCode: string;
			/** A non-i18n diagnostic (drizzle's error message) for logs. */
			readonly detail?: string;
			/**
			 * The error's remaining fields verbatim (everything except `code`), so nothing load-bearing
			 * is lost — e.g. `query_error`'s `sql`/`params`, or `check_error`'s `kind`/`branches` (the
			 * team-conflict substrate). The UI/logs read `code` first, `meta` for detail.
			 */
			readonly meta?: Readonly<Record<string, unknown>>;
	  };
