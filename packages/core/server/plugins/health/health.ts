import { Elysia } from 'elysia';
import { uptime } from 'node:process';

import { DEFAULT_HEALTH_CHECK_PATH } from '../../lib/consts';

import type { HealthCheckConfig } from '../../config/types/health';

/**
 * Injects a health check endpoint into the Elysia instance.
 * @param config - The health check configuration.
 * @returns The Elysia instance with the health check endpoint injected.
 */
export const healthCheckPlugin = (config?: HealthCheckConfig) => {
	const app = new Elysia({ name: '@glaze/health' });

	// Default to enabled if not specified
	if (config?.enabled === false) {
		return app;
	}

	// Normalize path: ensure leading slash, fallback to default if empty
	let path = config?.path?.trim() ?? DEFAULT_HEALTH_CHECK_PATH;
	if (!path.startsWith('/')) {
		path = `/${path}`;
	}

	return app.get(path, () => ({
		status: 'ok',
		timestamp: new Date().toISOString(),
		uptime: uptime(),
	}));
};
