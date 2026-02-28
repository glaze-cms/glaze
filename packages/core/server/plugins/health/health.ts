import { Elysia } from 'elysia';
import { uptime } from 'node:process';

import {
	DEFAULT_HEALTH_CHECK_PATH,
	type ResolvedHealthCheckConfig,
} from '@glaze/config';

/**
 * Injects a health check endpoint into the Elysia instance.
 * @param config - The health check configuration.
 * @returns The Elysia instance with the health check endpoint injected.
 */
export const healthCheckPlugin = (config: ResolvedHealthCheckConfig) => {
	const app = new Elysia({ name: '@glaze/health' });

	// Skip if disabled
	if (!config.enabled) {
		return app;
	}

	// Normalize path: ensure leading slash, fallback to default if empty
	let path = config.path.trim() || DEFAULT_HEALTH_CHECK_PATH;
	if (!path.startsWith('/')) {
		path = `/${path}`;
	}

	return app.get(path, () => ({
		status: 'ok',
		timestamp: new Date().toISOString(),
		uptime: uptime(),
	}));
};
