import type Elysia from 'elysia';
import type { LoggerOptions } from '@glaze/logger';

export interface DevelopmentConfig {
	/**
	 * Migration strategy for development
	 * - 'migrate': Generate migration files (recommended, safe)
	 * - 'push': Push schema directly to database (fast prototyping)
	 * @default 'migrate'
	 */
	strategy?: 'migrate' | 'push';

	/**
	 * Skip pending migration checks on startup
	 * Note: Schema drift checks cannot be skipped
	 * @default false
	 */
	skipMigrationChecks?: boolean;
}

export interface MigrationsConfig {
	/**
	 * Path to migrations folder
	 * @default "./migrations"
	 */
	folder?: string;

	/**
	 * Migrations table name in database
	 * @default "__drizzle_migrations"
	 */
	table?: string;

	/**
	 * PostgreSQL schema for migrations table
	 * @default "drizzle"
	 */
	schema?: string;
}

export interface ContentAPIConfig {
	/**
	 * Enable auto-generated CRUD endpoints
	 * @default true
	 */
	enabled?: boolean;

	/**
	 * Tables to exclude from auto-generation
	 * @default []
	 */
	exclude?: string[];
}

export interface GlazeInitialConfig {
	/**
	 * Drizzle schema as imported object
	 *
	 * @example
	 * ```typescript
	 * import * as schema from './schema';
	 *
	 * glazeConfig({
	 *   schema,
	 *   database: '...',
	 * });
	 * ```
	 */
	schema?: Record<string, unknown>;

	/**
	 * PostgreSQL connection URL
	 *
	 * @example "postgresql://user:pass@localhost:5432/mydb"
	 */
	database?: string;

	/**
	 * Port for the Glaze server
	 *
	 * @default 4000
	 */
	port?: number;

	/**
	 * API prefix for all Glaze routes
	 *
	 * @default "/api"
	 */
	prefix?: string;

	/**
	 * Custom Elysia routes to merge with auto-generated routes
	 * These routes can override auto-generated endpoints by path/method
	 *
	 * @example
	 * ```typescript
	 * import { Elysia } from 'elysia';
	 *
	 * const customRoutes = new Elysia()
	 *   .post('/posts', customCreatePost)
	 *   .get('/posts/published', getPublishedPosts);
	 *
	 * glazeConfig({
	 *   schema,
	 *   database: '...',
	 *   routes: customRoutes,
	 * });
	 * ```
	 */
	routes?: Elysia;

	/**
	 * Development environment settings
	 */
	development?: DevelopmentConfig;

	/**
	 * Database migration configuration
	 */
	migrations?: MigrationsConfig;

	/**
	 * Content API generation settings
	 */
	contentAPI?: ContentAPIConfig;

	/**
	 * Logger configuration (Pino)
	 */
	logger?: LoggerOptions;
}

/**
 * Resolved Glaze configuration with all defaults applied
 * This is the type returned by glazeConfig() and used internally
 */
export interface GlazeConfig extends GlazeInitialConfig {
	schema: Record<string, unknown>;
	database: string;
	prefix: string;
	development: DevelopmentConfig;
	migrations: MigrationsConfig;
	contentAPI: ContentAPIConfig;
	routes?: Elysia;
}

/**
 * Create and validate a Glaze configuration
 * Applies defaults and returns a fully resolved configuration
 *
 * @param config - Glaze configuration object
 * @returns Validated configuration with defaults applied
 *
 * @example
 * ```typescript
 * import { glazeConfig } from '@glaze/core';
 * import * as schema from './schema';
 *
 * export default glazeConfig({
 *   schema,
 *   database: process.env.DATABASE_URL,
 * });
 * ```
 */
export function glazeConfig(
	initialGlazeConfig: GlazeInitialConfig,
): GlazeConfig {
	return {
		...initialGlazeConfig,
		schema: initialGlazeConfig.schema,
		database: initialGlazeConfig.database,
		prefix: initialGlazeConfig.prefix ?? '/api',
		development: {
			strategy: initialGlazeConfig.development?.strategy ?? 'migrate',
			skipMigrationChecks:
				initialGlazeConfig.development?.skipMigrationChecks ?? false,
		},
		migrations: {
			folder: initialGlazeConfig.migrations?.folder ?? './migrations',
			table: initialGlazeConfig.migrations?.table ?? '__drizzle_migrations',
			schema: initialGlazeConfig.migrations?.schema ?? 'drizzle',
		},
		contentAPI: {
			enabled: initialGlazeConfig.contentAPI?.enabled ?? true,
			exclude: initialGlazeConfig.contentAPI?.exclude ?? [],
		},
	} as GlazeConfig;
}
