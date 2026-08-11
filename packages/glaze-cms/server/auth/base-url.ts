/**
 * Resolves the base URL Glaze passes to Better Auth (its `baseURL`), from which callbacks, redirects,
 * and cookie/trusted-origin decisions are derived.
 */

import { isProduction } from '#utils';

/**
 * Resolves Better Auth's base URL. An explicit `GLAZE_AUTH_URL` always wins. Otherwise, outside
 * production, it defaults to the local server origin so single-machine dev works with no configuration
 * (and Better Auth stops warning that callbacks/redirects may misbehave). In production it stays unset
 * unless configured — the public URL must be explicit there, and `http://localhost` would be wrong.
 *
 * @param port - The resolved listen port, used to build the dev-default origin.
 * @returns The base URL to pass to Better Auth, or `undefined` to let it infer per-request.
 */
export function resolveAuthBaseUrl(port: number): string | undefined {
	const configured = process.env['GLAZE_AUTH_URL'];
	if (configured) return configured;
	if (isProduction()) return undefined;
	return `http://localhost:${port}`;
}
