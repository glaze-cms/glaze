import type { Dialect } from '../dialect/types.ts';

export type { Dialect } from '../dialect/types.ts';

/**
 * Whether the generated migration files are kept. `solo` treats them as a disposable cache;
 * `team` commits them so the chain is shared. It does **not** decide whether a change is held for
 * review — that is `audit`.
 *
 * Not yet wired: both modes currently write to the configured `migrations` directory.
 */
export type WorkflowMode = 'solo' | 'team';

/** Collaboration workflow. Both axes are optional and default independently. */
export interface WorkflowConfig {
	/** @default 'solo' */
	mode?: WorkflowMode;
	/**
	 * Hold every structural change for a person: nothing applies until someone approves it, and the
	 * decision is recorded. Independent of {@link WorkflowMode} — committing the migrations and
	 * reviewing them are separate choices (see `specs/design/pending-approvals.md`).
	 *
	 * @default false when `mode` is `'solo'`, true when it is `'team'`
	 */
	audit?: boolean;
}

/** A {@link WorkflowConfig} with both axes resolved to concrete values. */
export interface ResolvedWorkflowConfig {
	mode: WorkflowMode;
	audit: boolean;
}

/**
 * The `glaze.config.ts` substrate: the tooling-facing config that must be loadable without
 * booting the server (dialect, connection, schema, migrations, workflow). Runtime-only wiring
 * (plugins, security, auth) lives in code, not here (see CLAUDE.md §4).
 */
export interface GlazeConfig {
	/** The database dialect. */
	dialect: Dialect;
	/** Postgres connection string, or the SQLite file path (typically an env reference). */
	connection: string;
	/**
	 * Path or glob to the Drizzle schema module(s) — the desired database state that convergence
	 * materializes at boot. A single file (`'./schema.ts'`) or the per-entity layout (`'./schema/*.ts'`)
	 * both work. Omitted ⇒ no user schema, and convergence is skipped.
	 */
	schema?: string;
	/**
	 * Directory for generated migration files (the snapshot chain).
	 * @default './drizzle'
	 */
	migrations?: string;
	/**
	 * Collaboration workflow.
	 * @default { mode: 'solo', audit: false }
	 */
	workflow?: WorkflowConfig;
}

/** A {@link GlazeConfig} with all optional fields resolved to their defaults. */
export interface ResolvedGlazeConfig {
	dialect: Dialect;
	connection: string;
	/** The schema path/glob, or `undefined` when the project has no user schema yet. */
	schema: string | undefined;
	migrations: string;
	workflow: ResolvedWorkflowConfig;
}
