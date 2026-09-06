/**
 * Builds the Better Auth instance for a Glaze server: the hybrid identity engine mounted under
 * `{apiPrefix}/auth`. Email/password with an httpOnly cookie session for the same-origin admin (a
 * `cookieCache` avoids a per-request DB read), plus the `bearer` plugin so the external content API can
 * authenticate with `Authorization: Bearer <token>`. Storage/queries go through the dialect-aware auth
 * schema via Drizzle. The built-in rate limiter is enabled and keys per-IP off `x-forwarded-for` — the
 * IP-forwarding plugin (see `./ip.ts`) supplies that header from the trusted peer address.
 *
 * Authentication only: the auth tables carry **no role column**, which is what stops a sign-up
 * request from claiming one. A new account's role is recorded in `glaze.principals` through the
 * enrolment hook below — decided by Glaze, never sent by the caller. No social/2FA/JWT (JWT would add
 * a `jwks` table and isn't needed for the bearer-token hybrid) — all deferred.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { openAPI } from 'better-auth/plugins';
import { bearer } from 'better-auth/plugins/bearer';

import { createPrincipalEnrolment } from '../approvals/index.ts';
import { resolveAuthBaseUrl } from './base-url.ts';
import { resolveAuthProvider } from './provider.ts';
import { buildAuthSchema } from './schema/index.ts';
import { resolveAuthSecret } from './secret.ts';

import type { GlazeContext } from '../app/context.ts';

/** The Better Auth instance Glaze composes — the source of the mount handler and the session API. */
export type GlazeAuth = ReturnType<typeof createAuth>;

/**
 * Composes the Glaze Better Auth instance from the resolved context.
 *
 * @param context - The Glaze context (database handle, config, resolved options).
 * @returns The configured Better Auth instance (its `handler` and `api` drive the mount + session).
 */
export function createAuth(context: GlazeContext) {
	const { db, config, options, logger } = context;
	const secret = resolveAuthSecret(logger);
	const baseURL = resolveAuthBaseUrl(options.port);

	return betterAuth({
		basePath: `${options.prefixes.api}/auth`,
		secret,
		// Route Better Auth's logs through Glaze's structured logger (silent under test) instead of
		// letting them bypass it to the console.
		logger: { log: (level, message) => logger[level](`[auth] ${message}`) },
		// Omit the key entirely when unresolved (production without GLAZE_AUTH_URL) — Better Auth then infers
		// per-request, and its options reject an explicit `undefined` under exactOptionalPropertyTypes.
		...(baseURL ? { baseURL } : {}),
		database: drizzleAdapter(db.db as Parameters<typeof drizzleAdapter>[0], {
			provider: resolveAuthProvider(config.dialect),
			schema: buildAuthSchema(config.dialect),
		}),
		emailAndPassword: { enabled: true },
		session: { cookieCache: { enabled: true } },
		// A new account gets its role here, decided by Glaze rather than asked for by the caller. The
		// rule lives in `server/approvals/enrolment.ts`; this is only the wiring.
		databaseHooks: { user: { create: { after: createPrincipalEnrolment(context) } } },
		// `openAPI` serves Better Auth's own reference (Scalar) at `{apiPrefix}/auth/reference` — the auth
		// routes are a schemaless catch-all in Glaze's content spec, so Better Auth documents them itself.
		// Gated on the docs toggle so `docs.enabled: false` turns off every docs surface together.
		plugins: options.docs.enabled ? [bearer(), openAPI()] : [bearer()],
		rateLimit: { enabled: true },
		// The rate limiter reads the client IP from this header; `./ip.ts` overwrites it with the
		// trusted peer address so a client cannot spoof its own bucket.
		advanced: { ipAddress: { ipAddressHeaders: ['x-forwarded-for'] } },
	});
}
