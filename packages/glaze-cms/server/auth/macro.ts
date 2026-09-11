/**
 * The route-protection macro — Elysia's idiomatic Better Auth gate. Routes opt in with `{ auth: true }`;
 * the macro resolves the session from the request headers (cookie **or** `Authorization: Bearer`, both
 * handled by Better Auth's `getSession`), returns 401 when there is none, and otherwise injects `user`
 * and `session` into the handler context for authorization decisions. Opt-in per route so an unprotected
 * route pays no `getSession` cost. See https://elysiajs.com/integrations/better-auth.html.
 */

import { Elysia } from 'elysia';

import { buildErrorResponse } from '../responses/index.ts';

/**
 * The minimal slice of the Better Auth instance the macro needs. Declaring it structurally (rather than
 * the full auth type) lets tests inject a stub `{ api: { getSession } }` without a cast.
 */
export interface SessionProvider {
	readonly api: {
		getSession(input: {
			headers: Headers;
			/**
			 * `disableCookieCache: true` makes Better Auth read the session table instead of trusting the
			 * signed session-data cookie, so a session revoked by sign-out is seen as gone at once.
			 */
			query?: { disableCookieCache?: boolean };
		}): Promise<{ readonly user: unknown; readonly session: unknown } | null>;
	};
}

/**
 * Builds the `auth` macro plugin. Apply it with `.use(createAuthMacro(auth))`, then mark protected
 * routes `{ auth: true }`.
 *
 * @param auth - The Better Auth instance (or a stub) providing `api.getSession`.
 * @returns An Elysia plugin exposing the `auth` macro.
 */
export function createAuthMacro(auth: SessionProvider) {
	return new Elysia({ name: 'glaze.auth.macro' }).macro({
		auth: {
			// A macro `derive` runs on beforeHandle: returning a `status(...)` short-circuits (the 401),
			// returning an object injects its keys (`user`/`session`) into the route context.
			async derive({ request }) {
				const result = await auth.api.getSession({ headers: request.headers });
				if (!result) return buildErrorResponse(401, 'UNAUTHORIZED', 'Authentication required');
				return { user: result.user, session: result.session };
			},
		},
	});
}
