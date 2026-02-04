import { Elysia } from 'elysia';
import { drizzle } from 'drizzle-orm/node-postgres';

/* Plugins */
import { healthCheckPlugin } from './plugins/health';
import { adminPlugin } from './plugins/admin';
import { corsPlugin } from './plugins/security';

/*  Types */
import type { GlazeEnv } from './validators/env';
import type { Logger } from '@glaze/logger';
import type { GlazeInternalConfig } from './validators/config';

/**
 * Creates a Glaze server instance.
 * @param env - The Glaze environment variables
 * @param logger - The Glaze logger instance
 * @param config - The Glaze configuration object
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
	const glaze = new Elysia({ name: '@glaze/server' })
		.decorate('env', env)
		.decorate('logger', logger)
		.decorate('config', config)
		.decorate('db', drizzle(env.GLAZE_DATABASE_URL, { schema: config.schema }))
		.use(healthCheckPlugin(config.healthCheck))
		.use(adminPlugin(config))
		.use(corsPlugin(config.security, env, logger));

	glaze.listen({ port: env.GLAZE_PORT }, () => {
		logger.info(
			`🧁 Glaze admin dashboard available at http://localhost:${env.GLAZE_PORT}${config.adminPrefix}`,
		);
	});

	return glaze;
}
