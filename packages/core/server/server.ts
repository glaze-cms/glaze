import { Elysia } from 'elysia';

/* Plugins */
import { envPlugin } from './plugins/env';
import { loggerPlugin } from './plugins/logger';

/* Modules */
import { adminModule } from './modules/admin';
import { healthCheckModule } from './modules/health';

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
	const glaze = new Elysia({ name: '@glaze/server' });

	/* Plugins */
	glaze.use(envPlugin(env)).use(loggerPlugin(logger));

	/* Modules */
	glaze.use(adminModule()).use(healthCheckModule());

	glaze.listen({ port: env.GLAZE_PORT }, () => {
		logger.info(
			`🧁 Glaze admin dashboard available on http://localhost:${env.GLAZE_PORT}/admin`,
		);
	});

	return glaze;
}
