/**
 * The auth plugin: mounts the Better Auth handler under `{apiPrefix}/auth` and forwards every auth
 * request through the IP shim so the rate limiter keys per trusted peer. A catch-all `all()` route is
 * used instead of `.mount()` because the handler needs Elysia's `server` to resolve the peer address.
 *
 * Route protection is not here: it is the opt-in `{ auth: true }` macro in `./macro.ts`, so a route
 * that needs no session pays for no lookup.
 */

import { Elysia } from 'elysia';

import { forwardTrustedIp, type PeerAddressSource } from './ip.ts';

import type { GlazeContext } from '../app/context.ts';
import type { GlazeAuth } from './instance.ts';
import type { HTTPHeaders } from 'elysia';

/** Elysia's response-mutation bag — the subset the auth handler reads and clears. */
interface ResponseSet {
	headers: HTTPHeaders;
}

/**
 * Builds the Glaze auth plugin from the resolved context and the shared Better Auth instance.
 *
 * @param context - The Glaze context (database handle, config, resolved options).
 * @param auth - The shared Better Auth instance (composed once at the composition root).
 * @returns An Elysia plugin serving Better Auth under `{apiPrefix}/auth`.
 */
export function createAuthPlugin(context: GlazeContext, auth: GlazeAuth) {
	const authBase = `${context.options.prefixes.api}/auth`;

	const handle = async (
		request: Request,
		server: PeerAddressSource | null,
		set: ResponseSet,
	): Promise<Response> => {
		const response = await auth.handler(forwardTrustedIp(request, server));

		// Better Auth sets multiple Set-Cookie headers (the session token + its cache). When `set.headers`
		// is populated and a handler returns a raw Response, Elysia's response-rebuild keeps only one of
		// the Response's Set-Cookie headers (verified on Bun and Node). Move the accumulated headers (e.g.
		// the security baseline) onto the Response directly and clear `set.headers`, so Elysia passes the
		// multi-cookie Response through verbatim.
		for (const [name, value] of Object.entries(set.headers)) {
			response.headers.set(name, String(value));
		}
		set.headers = {};
		return response;
	};

	return new Elysia({ name: 'glaze.auth' })
		.all(authBase, ({ request, server, set }) => handle(request, server, set))
		.all(`${authBase}/*`, ({ request, server, set }) => handle(request, server, set));
}
