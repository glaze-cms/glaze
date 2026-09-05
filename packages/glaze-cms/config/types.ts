import type { Dialect } from '../dialect/types.ts';

export type { Dialect } from '../dialect/types.ts';

/**
 * Whether Glaze keeps a file for every schema change, and where.
 *
 * Keeping them is not a filing preference: a committed chain is a thing a deployed machine
 * **applies**, while with no files every machine re-derives the diff for itself. See
 * `specs/design/pending-approvals.md`.
 */
export interface MigrationsConfig {
	/**
	 * Keep a file per schema change, committed and shared.
	 *
	 * Not yet honoured — the gitignored cache that makes `false` real is not built, so every project
	 * currently writes to {@link MigrationsConfig.path}.
	 *
	 * @default true
	 */
	enabled?: boolean;
	/**
	 * Directory for the migration files and their snapshots.
	 * @default './drizzle'
	 */
	path?: string;
}

/** A {@link MigrationsConfig} with both fields resolved. */
export interface ResolvedMigrationsConfig {
	enabled: boolean;
	path: string;
}

/** Collaboration workflow. */
export interface WorkflowConfig {
	/**
	 * Where a held change is answered: `true` files a pending approval for the admin screen, `false`
	 * asks at the terminal and fails closed when there is no terminal.
	 *
	 * It does **not** decide whether a change is held — one that destroys data always is.
	 *
	 * @default false
	 */
	audit?: boolean;
}

/** A {@link WorkflowConfig} with every field resolved. */
export interface ResolvedWorkflowConfig {
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
	 * Whether a file is kept for every schema change, and where.
	 * @default { enabled: true, path: './drizzle' }
	 */
	migrations?: MigrationsConfig;
	/**
	 * Collaboration workflow.
	 * @default { audit: false }
	 */
	workflow?: WorkflowConfig;
}

/** A {@link GlazeConfig} with all optional fields resolved to their defaults. */
export interface ResolvedGlazeConfig {
	dialect: Dialect;
	connection: string;
	/** The schema path/glob, or `undefined` when the project has no user schema yet. */
	schema: string | undefined;
	migrations: ResolvedMigrationsConfig;
	workflow: ResolvedWorkflowConfig;
}
