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
	const { port, security, prefixes, health, content, logger } = options;

	const adminPrefix = normalizePath(prefixes?.admin ?? DEFAULT_ADMIN_PREFIX);
	const apiPrefix = normalizePath(prefixes?.api ?? DEFAULT_API_PREFIX);
	assertUsablePrefixes(apiPrefix, adminPrefix);

	return {
		port: resolvePort(port),
		security: {
			cors: security?.cors,
			headers: resolveHeaders(security?.headers),
		},
		prefixes: { admin: adminPrefix, api: apiPrefix },
		health: {
			enabled: health?.enabled ?? true,
			path: normalizePath(health?.path ?? DEFAULT_HEALTH_PATH),
		},
		content: { exclude: content?.exclude ?? [] },
		logger,
	};
}

/**
 * Rejects prefix misconfigurations that would break routing or the reserved-prefix advisory: a root
 * (`/`) prefix swallows every route, and equal api/admin prefixes make the two surfaces ambiguous.
 *
 * @param api - The normalized API prefix.
 * @param admin - The normalized admin prefix.
 * @throws {Error} When a prefix is root or the two are equal.
 */
function assertUsablePrefixes(api: string, admin: string): void {
	if (api === '/' || admin === '/') {
		throw new Error(`Glaze route prefixes must not be root '/': api='${api}', admin='${admin}'.`);
	}
	if (api === admin) {
		throw new Error(`Glaze api and admin prefixes must differ: both are '${api}'.`);
	}
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
		// User directives spread first, then the locked baseline overrides — a user can ADD directives
		// (e.g. `img-src`) but cannot WEAKEN the protected keys (`default-src`, `frame-ancestors`, …).
		csp: { ...headers?.csp, ...DEFAULT_CSP },
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

	// A set-but-empty/whitespace `PORT=` is a blanked-out var, not port 0 — treat it as absent.
	const fromEnv = (process.env['PORT'] ?? process.env['GLAZE_PORT'])?.trim();
	if (!fromEnv) return DEFAULT_PORT;

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
