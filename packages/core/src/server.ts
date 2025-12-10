import Elysia from 'elysia';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';

import { createLogger } from '@glaze/logger';
import { GLAZE_VERSION } from '@glaze/shared';
import { glazeConfig, type GlazeInitialConfig } from './config';

/**
 * Validate Glaze configuration
 * Throws descriptive errors if config is invalid
 */
function validateConfig(config: GlazeInitialConfig): void {
	// 1. Check required fields
	if (!config.database) {
		throw new Error(
			'❌ Missing required field: database\n' +
				'   Provide a PostgreSQL connection URL in your config',
		);
	}

	if (!config.schema) {
		throw new Error(
			'❌ Missing required field: schema\n' +
				'   Provide path to your Drizzle schema or imported schema object',
		);
	}

	// 2. Validate database URL format
	if (
		!config.database.startsWith('postgres://') &&
		!config.database.startsWith('postgresql://')
	) {
		throw new Error(
			`❌ Invalid database URL: ${config.database}\n` +
				'   Glaze requires PostgreSQL. Expected postgres:// or postgresql:// prefix.',
		);
	}

	// 3. Validate strategy enum
	if (
		config.development?.strategy &&
		!['migrate', 'push'].includes(config.development.strategy)
	) {
		throw new Error(
			`❌ Invalid development.strategy: ${config.development.strategy}\n` +
				'   Must be "migrate" or "push"',
		);
	}

	// 4. Block push mode in production
	const isProduction = process.env.NODE_ENV === 'production';
	if (isProduction && config.development?.strategy === 'push') {
		throw new Error(
			'❌ Push mode is not allowed in production!\n' +
				'   Use migrations for production deployments.\n' +
				'   Set development.strategy to "migrate"',
		);
	}
}

export function createGlazeServer(config: GlazeInitialConfig) {
	// Validate config first
	validateConfig(config);

	// Apply defaults (in case user didn't use glazeConfig())
	const finalConfig = glazeConfig(config);

	// Destructure - no need for defaults, glazeConfig already handled them
	const { database, schema, prefix, routes } = finalConfig;

	const logger = createLogger({
		name: 'glaze',
		...finalConfig.logger,
	});

	logger.info(`🍰 Glaze CMS v${GLAZE_VERSION} starting...`);

	// Initialize PostgreSQL connection using Bun's native driver
	logger.info('Connecting to PostgreSQL...');
	const db = drizzle(database, { schema });

	// Create Elysia app
	const app = new Elysia({ prefix })
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

				// Clean up the error message
				const errorMessage =
					error instanceof Error
						? error.message.split('\n')[0] // Take only first line
						: 'Unknown error';

				return {
					status: 'error' as const,
					database: 'disconnected' as const,
					error: errorMessage,
					timestamp: new Date().toISOString(),
				};
			}
		});

	// TODO: Auto-generate Content API (Phase 2)
	// if (schema && contentAPI.enabled) {
	//   createContentAPI(app, schema, db, logger, contentAPI);
	// }

	// Merge user's custom routes if provided
	if (routes) {
		app.use(routes);
	}

	// Startup hook
	app.onStart(() => {
		logger.info(`🍰 Glaze CMS v${GLAZE_VERSION} ready 🚀`);
		logger.info(`   API prefix: ${prefix}`);
	});

	return app;
}

export type GlazeServer = ReturnType<typeof createGlazeServer>;
