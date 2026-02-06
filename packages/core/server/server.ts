import { Elysia } from 'elysia';
import { drizzle } from 'drizzle-orm/node-postgres';

/* Plugins */
import { authPlugin } from './plugins/auth';
import { healthCheckPlugin } from './plugins/health';
import { adminPlugin } from './plugins/admin';
import { corsPlugin } from './plugins/security';

/* Hooks */
import { handleStart } from './hooks';

/*  Types */
import type { GlazeEnv } from './validators/env';
import type { Logger } from '@glaze/logger';
import type { GlazeInternalConfig } from './validators/config';

/**
 * Creates a Glaze server instance.
 * @param env - The Glaze environment variables
 * @param logger - The Glaze logger instance
 * @param config - The Glaze configuration object, validated and resolved - includes defaults
 * @returns The Glaze server instance
 */
export function createGlazeServer({
	env,
	config,
	logger,
}: {
	env: GlazeEnv;
	config: GlazeInternalConfig;
	logger: Logger;
}) {
	// Create database instance first (needed for auth plugin)
	const db = drizzle(env.GLAZE_DATABASE_URL, { schema: config.schema });

	const glaze = new Elysia({ name: '@glaze/server' })
		.decorate('env', env)
		.decorate('logger', logger)
		.decorate('config', config)
		.decorate('db', db)
		.use(healthCheckPlugin(config.healthCheck))
		.use(adminPlugin(config))
		.use(corsPlugin(config.security, env, logger))
		.use(authPlugin(config, env, db))
		.onStart(handleStart);

	const fullyQualifiedAdminAddress = `http://${glaze.server?.hostname}:${env.GLAZE_PORT}${config.adminPrefix}`;
	logger.info(
		`🚀 Glaze Admin Dashboard available at: ${fullyQualifiedAdminAddress}`,
	);

	return glaze;
}
