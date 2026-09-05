import type {
	GlazeConfig,
	MigrationsConfig,
	ResolvedGlazeConfig,
	ResolvedMigrationsConfig,
	ResolvedWorkflowConfig,
	WorkflowConfig,
} from './types.ts';

/** Default directory for the migration files and their snapshots. */
const DEFAULT_MIGRATIONS_PATH = './drizzle';

/**
 * Keep the files unless told otherwise. This matches what Glaze actually does today: the gitignored
 * cache that would make `false` real is not built yet, so a default of `false` would describe
 * behaviour the code does not have.
 */
const DEFAULT_MIGRATIONS_ENABLED = true;

/**
 * Answer a held change at the terminal by default. A project that deploys sets `audit: true` so the
 * question reaches a screen instead; either way a change that destroys data is held.
 */
const DEFAULT_AUDIT = false;

/**
 * Resolves the migrations settings.
 *
 * @param migrations - The user-provided migrations config, if any.
 * @returns The settings with `enabled` and `path` both concrete.
 */
function resolveMigrations(migrations: MigrationsConfig | undefined): ResolvedMigrationsConfig {
	return {
		enabled: migrations?.enabled ?? DEFAULT_MIGRATIONS_ENABLED,
		path: migrations?.path ?? DEFAULT_MIGRATIONS_PATH,
	};
}

/**
 * Resolves the workflow settings.
 *
 * @param workflow - The user-provided workflow config, if any.
 * @returns The workflow with every field concrete.
 */
function resolveWorkflow(workflow: WorkflowConfig | undefined): ResolvedWorkflowConfig {
	return { audit: workflow?.audit ?? DEFAULT_AUDIT };
}

/**
 * Resolves a user {@link GlazeConfig} into a {@link ResolvedGlazeConfig}, filling every
 * optional field with its default.
 *
 * @param config - The user-provided configuration.
 * @returns The configuration with all defaults applied.
 */
export function resolveConfig(config: GlazeConfig): ResolvedGlazeConfig {
	return {
		dialect: config.dialect,
		connection: config.connection,
		schema: config.schema,
		migrations: resolveMigrations(config.migrations),
		workflow: resolveWorkflow(config.workflow),
	};
}
