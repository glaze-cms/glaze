import { Elysia } from 'elysia';

/* Plugins */
import { envPlugin } from './plugins/env';
import { loggerPlugin } from './plugins/logger';

/* Handlers */
import { handleAdmin } from './modules/admin';
import { createHealthCheckResponse } from './modules/health';

/*  Types */
import type { GlazeEnv } from './validators/env';
import type { Logger } from '@glaze/logger';

/**
 * Creates a Glaze server instance.
 * @param env - The Glaze environment variables
 * @param logger - The Glaze logger instance
 * @returns The Glaze server instance
 */
export function createGlazeServer({
	env,
	logger,
}: {
	env: GlazeEnv;
	logger: Logger;
}) {
	/* Create and configure server with chained methods for type inference */
	const glaze = new Elysia({ name: '@glaze/server' })
		.use(envPlugin(env))
		.use(loggerPlugin(logger))
		.all('/admin/*', ({ request, path }) => handleAdmin({ request, path }))
		.all('/admin', ({ request, path }) => handleAdmin({ request, path }))
		.get('/_health', ({ env }) => createHealthCheckResponse(env));

	glaze.listen({ port: env.GLAZE_PORT }, () => {
		logger.info(
			`🧁 Glaze admin dashboard available on http://localhost:${env.GLAZE_PORT}/admin`,
		);
	});

	return glaze;
}
