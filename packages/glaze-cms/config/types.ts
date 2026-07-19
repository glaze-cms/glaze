import type { Dialect } from '../dialect/types.ts';

export type { Dialect } from '../dialect/types.ts';

/**
 * Which collaboration workflow the project runs. Expanded during the convergence step
 * (gated behind the drizzle-kit RC deep dive) — kept minimal here.
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
	 * The Drizzle schema (table definitions) as an object of exports.
	 * @default {}
	 */
	schema?: Record<string, unknown>;
	/**
	 * Directory for generated migration files.
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
	schema: Record<string, unknown>;
	migrations: string;
	workflow: WorkflowConfig;
}
