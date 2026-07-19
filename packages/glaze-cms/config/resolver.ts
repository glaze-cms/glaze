import type { GlazeConfig, ResolvedGlazeConfig } from './types.ts';

/** Default directory for generated migration files. */
const DEFAULT_MIGRATIONS_DIR = './drizzle';

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
		schema: config.schema ?? {},
		migrations: config.migrations ?? DEFAULT_MIGRATIONS_DIR,
		workflow: config.workflow ?? { mode: 'solo' },
	};
}
