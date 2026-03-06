import { Elysia } from 'elysia';
import { drizzle } from 'drizzle-orm/node-postgres';

/* Plugins */
import { authPlugin } from './plugins/auth';
import { rbacPlugin } from './plugins/rbac';
import { healthCheckPlugin } from './plugins/health';
import { adminPlugin } from './plugins/admin';
import { schemaPlugin } from './plugins/schema';
import { corsPlugin, rateLimitPlugin } from './plugins/security';

/* Hooks */
import { handleStart } from './hooks';

/* Schema */
import * as authSchema from '../schema';

/*  Types */
import type { GlazeEnv, GlazeInternalConfig } from '@glaze/config';
import type { Logger } from '@glaze/logger';

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
	const schema = { ...config.schema, ...authSchema };

	const glaze = new Elysia({ name: '@glaze/server' })
		.decorate('env', env)
		.decorate('logger', logger)
		.decorate('config', config)
		.decorate('schema', schema)
		.decorate('db', drizzle(env.GLAZE_DATABASE_URL, { schema }))
		.use(rateLimitPlugin(config.security, env, logger))
		.use(corsPlugin(config.security, env, logger))
		.use(healthCheckPlugin(config.healthCheck))
		.use(adminPlugin(config))
		.use(authPlugin(config, env))
		.use(rbacPlugin(config))
		.use(schemaPlugin(config, env))
		.get('/', () => ({
			message: 'Glaze CMS Server',
			admin: config.adminPrefix,
			health: config.healthCheck.path,
		}))
		.onStart(({ decorator }) => handleStart({ decorator }));

	const fullyQualifiedAdminAddress = `${env.GLAZE_SERVER_URL ?? `http://localhost:${env.GLAZE_PORT}`}${config.adminPrefix}`;
	logger.info(
		`🚀 Glaze Admin Dashboard available at: ${fullyQualifiedAdminAddress}`,
	);

	return glaze;
}
