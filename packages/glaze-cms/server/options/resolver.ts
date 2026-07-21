/**
 * Fills {@link GlazeOptions} with Glaze's secure defaults, producing the fully-concrete
 * {@link ResolvedGlazeOptions} the composition root consumes. Pure — no side effects, no env boot.
 */

import {
	DEFAULT_ADMIN_PREFIX,
	DEFAULT_API_PREFIX,
	DEFAULT_CSP,
	DEFAULT_HEALTH_PATH,
	DEFAULT_PORT,
} from '#consts';
import { isProduction } from '#utils';

import type {
	GlazeOptions,
	HeadersOptions,
	ResolvedGlazeOptions,
	ResolvedHeadersOptions,
} from './types.ts';

/**
 * Resolves runtime options against Glaze's defaults.
 *
 * @param options - The user-supplied runtime options (all fields optional).
 * @returns The fully-resolved options with every field concrete.
 */
export function resolveOptions(options: GlazeOptions = {}): ResolvedGlazeOptions {
	const { port, security, prefixes, health, logger } = options;

	return {
		port: resolvePort(port),
		security: {
			cors: security?.cors,
			headers: resolveHeaders(security?.headers),
		},
		prefixes: {
			admin: normalizePath(prefixes?.admin ?? DEFAULT_ADMIN_PREFIX),
			api: normalizePath(prefixes?.api ?? DEFAULT_API_PREFIX),
		},
		health: {
			enabled: health?.enabled ?? true,
			path: normalizePath(health?.path ?? DEFAULT_HEALTH_PATH),
		},
		logger,
	};
}

/**
 * Resolves security headers: the secure CSP baseline merged with any user directives, and HSTS
 * defaulting to on in production.
 *
 * @param headers - The user header options, if any.
 * @returns The resolved header configuration.
 */
function resolveHeaders(headers: HeadersOptions | undefined): ResolvedHeadersOptions {
	return {
		csp: { ...DEFAULT_CSP, ...headers?.csp },
		hsts: headers?.hsts ?? isProduction(),
	};
}

/**
 * Resolves the listen port: an explicit option wins, else `PORT`/`GLAZE_PORT` from the environment,
 * else the default.
 *
 * @param port - The explicit port option, if any.
 * @returns The resolved port.
 */
function resolvePort(port: number | undefined): number {
	if (port !== undefined) return port;

	const fromEnv = process.env['PORT'] ?? process.env['GLAZE_PORT'];
	if (fromEnv === undefined) return DEFAULT_PORT;

	const parsed = Number(fromEnv);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_PORT;
}

/**
 * Normalizes a route path/prefix: guarantees a single leading `/` and strips a trailing `/` (except
 * the root `/` itself).
 *
 * @param path - The path or prefix as authored (e.g. `admin`, `/api/`).
 * @returns The normalized path (e.g. `/admin`, `/api`).
 */
function normalizePath(path: string): string {
	const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
	return withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')
		? withLeadingSlash.slice(0, -1)
		: withLeadingSlash;
}
