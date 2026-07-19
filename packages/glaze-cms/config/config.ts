import type { GlazeConfig } from './types.ts';

/**
 * Defines a Glaze configuration with full type-checking and editor autocomplete.
 *
 * This is an identity helper: it returns the config unchanged, but typing the argument gives
 * you inline docs, autocomplete, and typo detection in your `glaze.config.ts`.
 *
 * @param config - The Glaze configuration.
 * @returns The same configuration, typed.
 *
 * @example
 * ```ts
 * // glaze.config.ts
 * import { defineGlazeConfig } from 'glaze-cms/config';
 * import * as schema from './schema';
 *
 * export default defineGlazeConfig({
 * 	dialect: 'postgres',
 * 	connection: process.env.DATABASE_URL!,
 * 	schema,
 * 	workflow: { mode: 'solo' },
 * });
 * ```
 */
export function defineGlazeConfig(config: GlazeConfig): GlazeConfig {
	return config;
}
