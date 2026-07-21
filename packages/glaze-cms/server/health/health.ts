/**
 * The health-check plugin: a `GET {path}` returning liveness info (status, timestamp, uptime). Returns
 * an empty plugin when disabled, so the composition root can always `.use()` it unconditionally.
 */

import { Elysia } from 'elysia';

/**
 * Builds the health-check plugin.
 *
 * @param options - Whether the route is enabled, and the (normalized) path to serve it at.
 * @returns An Elysia plugin — the health route when enabled, an empty plugin otherwise.
 */
export function createHealthCheck(options: { readonly enabled: boolean; readonly path: string }) {
	const plugin = new Elysia({ name: 'glaze.health' });
	if (!options.enabled) return plugin;

	return plugin.get(options.path, () => ({
		status: 'ok',
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
	}));
}
