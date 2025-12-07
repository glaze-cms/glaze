import { Elysia } from 'elysia';
import { drizzle, type BunSQLDatabase } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';

import { createLogger, type LoggerOptions } from '@glaze/logger';
import { GLAZE_VERSION } from '@glaze/shared';

/**
 * Configuration options for creating a Glaze server
 */
export interface GlazeConfig {
	/**
	 * PostgreSQL connection URL
	 * @example "postgres://user:pass@localhost:5432/mydb"
	 */
	database: string;

	/**
	 * Drizzle schema object(s).
	 * Import your schema and pass it directly here.
	 *
	 * @example
	 * ```typescript
	 * import * as schema from './schema';
	 *
	 * createGlazeServer({
	 *   database: '...',
	 *   schema,
	 * });
	 * ```
	 */

	schema?: Record<string, unknown>;

	/**
	 * API prefix for all Glaze routes
	 * @default "/api"
	 */
	prefix?: string;

	/**
	 * Custom Elysia routes to merge with Glaze
	 * Build your routes first, then pass them here
	 *
	 * @example
	 * ```typescript
	 * const customRoutes = new Elysia()
	 *   .get('/custom', () => 'hello')
	 *   .post('/webhooks/stripe', handleStripe);
	 *
	 * createGlazeServer({
	 *   database: '...',
	 *   routes: customRoutes,
	 * });
	 * ```
	 */
	routes?: Elysia;

	/**
	 * Logger configuration
	 */
	logger?: LoggerOptions;
}

export type GlazeDatabase = BunSQLDatabase;

/**
 * Creates a Glaze CMS server instance
 *
 * @example
 * ```typescript
 * // Standalone mode
 * const glaze = createGlazeServer({
 *   database: process.env.DATABASE_URL!,
 * });
 * glaze.listen(4000);
 *
 * // With custom routes
 * const api = new Elysia()
 *   .get('/custom', () => 'hello');
 *
 * const glaze = createGlazeServer({
 *   database: process.env.DATABASE_URL!,
 *   routes: api,
 * });
 * ```
 */
export function createGlazeServer(config: GlazeConfig) {
	const { database, schema, prefix = '/api', routes } = config;

	const logger = createLogger({
		name: 'glaze',
		...config.logger,
	});

	logger.info(`🍰 Glaze CMS v${GLAZE_VERSION} starting...`);

	// Validate PostgreSQL connection string
	if (
		!database.startsWith('postgres://') &&
		!database.startsWith('postgresql://')
	) {
		throw new Error(
			`Invalid database URL: ${database}. ` +
				`Glaze requires PostgreSQL. Expected postgres:// or postgresql:// prefix.`,
		);
	}

	// Initialize PostgreSQL connection using Bun's native driver
	logger.info('Connecting to PostgreSQL...');
	const db = schema ? drizzle(database, { schema }) : drizzle(database);

	// Create Elysia app
	const app = new Elysia({ prefix })
		// Decorate context with database and logger
		.decorate('db', db)
		.decorate('logger', logger)
		.decorate('schema', schema)

		// Health check endpoint
		.get('/health', ({ set }) => {
			set.status = 200;
			return {
				status: 'ok' as const,
				version: GLAZE_VERSION,
				timestamp: new Date().toISOString(),
			};
		})

		// Ready check (verifies database connection)
		.get('/ready', async ({ db, set }) => {
			try {
				await db.execute(sql`SELECT 1`);
				set.status = 200;
				return {
					status: 'ready' as const,
					database: 'connected' as const,
					timestamp: new Date().toISOString(),
				};
			} catch (error) {
				set.status = 503;
				return {
					status: 'error' as const,
					database: 'disconnected' as const,
					error: error instanceof Error ? error.message : 'Unknown error',
					timestamp: new Date().toISOString(),
				};
			}
		});

	// Merge user's custom routes if provided
	if (routes) {
		app.use(routes);
	}

	// Startup hook
	app.onStart(() => {
		logger.info(`🍰 Glaze CMS v${GLAZE_VERSION} ready`);
		logger.info(`   API prefix: ${prefix}`);
	});

	return app;
}

export type GlazeServer = ReturnType<typeof createGlazeServer>;
