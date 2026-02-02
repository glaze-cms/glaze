import { Elysia } from 'elysia';

/* Plugins */
import { envPlugin } from './plugins/env';
import { loggerPlugin } from './plugins/logger';

/* Handlers */
import { handleAdmin } from './modules/admin';
import { handleHealthCheck } from './modules/health';

/*  Types */
import type { GlazeEnv } from './validators/env';
import type { Logger } from '@glaze/logger';
import type { GlazeInternalConfig } from './validators/config/config';
import { configPlugin } from './plugins/config';

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
	/* Create and configure server. We use chained methods to keep type inference */
	const adminPrefix = config.adminPrefix;
	const adminRoute = `${adminPrefix}/*`;
	const isDevProxy = process.env.GLAZE_INTERNAL__ADMIN_PROXY === 'true';
	// In dev with a custom admin prefix, we need to fallback to /admin for Vite assets
	const needsViteFallback = isDevProxy && adminPrefix !== '/admin';

	const glaze = new Elysia({ name: '@glaze/server' })
		.use(envPlugin(env))
		.use(loggerPlugin(logger))
		.use(configPlugin(config))
		.use((app) =>
			config.healthCheck.enabled
				? app.get(config.healthCheck.path, ({ env }) => handleHealthCheck(env))
				: app,
		)
		.all(adminRoute, ({ request, path }) =>
			handleAdmin({ request, path, adminPrefix }),
		)
		.all(adminPrefix, ({ request, path }) =>
			handleAdmin({ request, path, adminPrefix }),
		)
		.use((app) =>
			needsViteFallback
				? app
						.all('/admin/*', ({ request, path }) =>
							handleAdmin({ request, path, adminPrefix: '/admin' }),
						)
						.all('/admin', ({ request, path }) =>
							handleAdmin({ request, path, adminPrefix: '/admin' }),
						)
				: app,
		);

	glaze.listen({ port: env.GLAZE_PORT }, () => {
		logger.info(
			`🧁 Glaze admin dashboard available on http://localhost:${env.GLAZE_PORT}${config.adminPrefix}`,
		);
	});

	return glaze;
}
