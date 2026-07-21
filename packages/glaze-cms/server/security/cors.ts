/**
 * The CORS plugin for the external content API. **Deny-by-default**: with no configured origin it
 * emits no `Access-Control-Allow-Origin` at all (the same-origin admin needs no CORS — CLAUDE.md §10).
 * Credentials are only ever sent when an explicit origin allow-list is given — never with a wildcard.
 * The composition root mounts this on the content-API group, never globally.
 */

import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';

import type { CorsOptions } from '../options/index.ts';

/**
 * Builds the content-API CORS plugin.
 *
 * @param options - The CORS options, or `undefined`/no-origin for deny-by-default.
 * @returns An Elysia plugin — the configured CORS when an origin is given, an empty plugin otherwise.
 */
export function createCorsPlugin(options: CorsOptions | undefined) {
	const plugin = new Elysia({ name: 'glaze.cors' });
	if (!options?.origin) return plugin;

	return plugin.use(
		cors({
			origin: options.origin,
			credentials: options.credentials ?? false,
			methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
			allowedHeaders: ['Content-Type', 'Authorization'],
		}),
	);
}
