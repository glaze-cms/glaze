/**
 * Content-API CORS — **deny-by-default** and **scoped to the content routes only**. The same-origin
 * admin needs no CORS (CLAUDE.md §10); credentials are honoured only with an explicit origin allow-list,
 * never a wildcard.
 *
 * This is a small responder rather than `@elysiajs/cors` on purpose: that plugin registers its hooks as
 * `global`, so wrapping it in a named plugin does NOT contain it — its `Access-Control-Allow-Origin`
 * leaks onto sibling scopes (the root manifest, the Better Auth routes). The content router instead
 * applies this responder through a **local** `onAfterHandle` (and per-route `OPTIONS` preflight), which
 * Elysia scopes to that instance's routes — so CORS never rides on the auth or admin surface.
 */

import type { CorsOptions } from '../options/index.ts';

/** Preflight advertises exactly the methods the content router serves. */
const PREFLIGHT_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';
/** The default request headers allowed at preflight when the client doesn't ask for specific ones. */
const DEFAULT_ALLOWED_HEADERS = 'Content-Type, Authorization';

/** Applies content-API CORS to responses and answers preflight, for an allowed origin only. */
export interface CorsResponder {
	/**
	 * Adds the simple-request CORS headers to a response header bag, when the request origin is allowed.
	 *
	 * @param headers - The response header bag to mutate (Elysia's `set.headers`).
	 * @param requestOrigin - The request's `Origin` header, or `null`.
	 */
	decorate(headers: Record<string, string | number>, requestOrigin: string | null): void;
	/**
	 * Builds the preflight (`OPTIONS`) response — a 204 carrying the CORS headers when the origin is
	 * allowed, an empty 204 otherwise.
	 *
	 * @param request - The preflight request.
	 * @returns The preflight response.
	 */
	preflight(request: Request): Response;
}

/**
 * Builds an origin matcher from the configured allow-list (exact strings and/or regexes).
 *
 * @param origin - The configured origin(s).
 * @returns A predicate that is true for an allowed origin.
 */
function buildOriginMatcher(
	origin: string | RegExp | Array<string | RegExp>,
): (candidate: string) => boolean {
	const patterns = Array.isArray(origin) ? origin : [origin];
	return (candidate) =>
		patterns.some((pattern) =>
			typeof pattern === 'string' ? pattern === candidate : pattern.test(candidate),
		);
}

/**
 * Builds the content-API CORS responder, or `null` for deny-by-default (no configured origin ⇒ no CORS
 * headers, no preflight answered).
 *
 * @param options - The CORS options, or `undefined`.
 * @returns A {@link CorsResponder}, or `null` when CORS is not configured.
 */
export function createCorsResponder(options: CorsOptions | undefined): CorsResponder | null {
	if (!options?.origin) return null;

	const isAllowed = buildOriginMatcher(options.origin);
	const credentials = options.credentials ?? false;
	const commonHeaders = (origin: string): Record<string, string> => ({
		'access-control-allow-origin': origin,
		vary: 'Origin',
		...(credentials ? { 'access-control-allow-credentials': 'true' } : {}),
	});

	return {
		decorate(headers, requestOrigin) {
			if (!requestOrigin || !isAllowed(requestOrigin)) return;
			Object.assign(headers, commonHeaders(requestOrigin));
		},
		preflight(request) {
			const origin = request.headers.get('origin');
			if (!origin || !isAllowed(origin)) return new Response(null, { status: 204 });
			return new Response(null, {
				status: 204,
				headers: {
					...commonHeaders(origin),
					'access-control-allow-methods': PREFLIGHT_METHODS,
					'access-control-allow-headers':
						request.headers.get('access-control-request-headers') ?? DEFAULT_ALLOWED_HEADERS,
				},
			});
		},
	};
}
