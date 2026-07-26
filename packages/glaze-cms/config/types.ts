import type { Dialect } from '../dialect/types.ts';

export type { Dialect } from '../dialect/types.ts';

/**
 * Which collaboration workflow the project runs. Expanded during the convergence step
 */
export type WorkflowMode = 'solo' | 'team';

/** Workflow configuration. */
export interface WorkflowConfig {
	/** @default 'solo' */
	mode: WorkflowMode;
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
	 * @default { mode: 'solo' }
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
	workflow: WorkflowConfig;
}
