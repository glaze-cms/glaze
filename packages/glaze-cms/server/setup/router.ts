/**
 * The setup routes: how a fresh Glaze gets its first admin.
 *
 * Signing up grants nothing — every new account is a `user`. The first admin is made by an account
 * that is already signed in **claiming** it, and the claim is sealed the moment an admin exists: from
 * then on it answers 403 to everybody. It is the one grant that has no admin to make it, so the empty
 * table stands in for one. Both routes answer in the `{ success, data, error }` envelope.
 */

import { Elysia, NotFound, status } from 'elysia';

import { buildApprovalSchema, claimFirstAdmin, hasAdmin } from '../approvals/index.ts';
import { buildErrorResponse, buildSuccessResponse } from '../responses/index.ts';
import { isSetupTokenValid, readSetupToken, SETUP_TOKEN_HEADER } from './token.ts';

import type { GlazeContext } from '../app/context.ts';
import type { ApprovalDb } from '../approvals/index.ts';
import type { SessionProvider } from '../auth/index.ts';
import type { Table } from 'drizzle-orm';

/** The path segment the setup routes live under, beneath the API prefix. */
export const SETUP_ROUTE_NAME = 'setup';

/** The inputs the setup router is composed from. */
interface SetupRouterInput {
	/** The Glaze context (db handle, resolved options, logger). */
	readonly context: GlazeContext;
	/** The shared Better Auth instance backing the route gate. */
	readonly auth: SessionProvider;
}

/** Who is asking: a live account, nobody, or a session Glaze cannot read an account out of. */
type Claimant =
	| { readonly kind: 'user'; readonly id: string }
	| { readonly kind: 'none' }
	| { readonly kind: 'malformed' };

/**
 * Resolves the signed-in account for the claim, from the session **table** rather than the cookie
 * cache. The shared `{ auth: true }` macro accepts the signed session-data cookie for a few minutes
 * after sign-out, which is fine for reading content and not fine for the one write that makes an
 * admin; so this route asks Better Auth to look the session up.
 *
 * @param auth - The Better Auth instance.
 * @param headers - The request headers (cookie or bearer token).
 * @returns The account; `none` when there is no live session; `malformed` when there is one but it
 *   carries no usable id, which is a server fault rather than the caller's.
 */
async function resolveClaimant(auth: SessionProvider, headers: Headers): Promise<Claimant> {
	const result = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
	if (!result) return { kind: 'none' };
	const id = (result.user as { id?: unknown } | null)?.id;
	return typeof id === 'string' && id.length > 0 ? { kind: 'user', id } : { kind: 'malformed' };
}

/**
 * Builds the setup router: `GET {api}/setup` says whether a first admin is still needed, and
 * `POST {api}/setup/first-admin` grants `admin` to the signed-in account while none exists.
 *
 * @param input - The context and the auth instance.
 * @returns An Elysia plugin serving the setup routes.
 */
export function createSetupRouter({ context, auth }: SetupRouterInput) {
	const { db, config, logger, options } = context;
	const base = `${options.prefixes.api}/${SETUP_ROUTE_NAME}`;
	const principals = buildApprovalSchema(config.dialect).principals as Table;

	return (
		new Elysia({ name: 'glaze.setup' })
			// Keep every setup-route error in the envelope; unhandled, Elysia would answer with
			// `application/problem+json` and break the response contract.
			.error(({ error }) => {
				if (error instanceof NotFound) return buildErrorResponse(404, 'NOT_FOUND', 'Not found');
				const detail =
					error instanceof Error ? (error.stack ?? error.message) : JSON.stringify(error);
				logger.error(`Unhandled setup-route error: ${detail}`);
				return buildErrorResponse(500, 'INTERNAL', 'Internal server error');
			})
			.get(base, async () => {
				const sealed = await hasAdmin(db.db as ApprovalDb, principals);
				return buildSuccessResponse({ firstAdminNeeded: !sealed });
			})
			.post(`${base}/first-admin`, async ({ request }) => {
				const claimant = await resolveClaimant(auth, request.headers);
				if (claimant.kind === 'none') {
					return buildErrorResponse(401, 'UNAUTHORIZED', 'Authentication required');
				}
				if (claimant.kind === 'malformed') {
					logger.error('The session for a first-admin claim carries no usable user id.');
					return buildErrorResponse(500, 'INTERNAL', 'Internal server error');
				}
				const userId = claimant.id;

				// The seal is public (`GET` says the same), so it is checked before the token: once an admin
				// exists, the token can no longer be probed through this route.
				if (await hasAdmin(db.db as ApprovalDb, principals)) {
					return buildErrorResponse(403, 'FORBIDDEN', 'An admin already exists');
				}
				const expected = readSetupToken();
				if (expected && !isSetupTokenValid(request.headers.get(SETUP_TOKEN_HEADER), expected)) {
					return buildErrorResponse(403, 'FORBIDDEN', 'A valid setup token is required');
				}

				// The lock, the read and the write share one transaction; the pre-check above is only an
				// early answer, and `claimFirstAdmin` decides.
				const granted = await db.queryTransaction((tx) =>
					claimFirstAdmin(tx as ApprovalDb, principals, userId, config.dialect),
				);
				if (!granted) {
					return buildErrorResponse(403, 'FORBIDDEN', 'An admin already exists');
				}

				logger.info(`Glaze granted admin to account ${userId}, the first to claim it.`);
				return status(201, buildSuccessResponse({ role: 'admin' as const }));
			})
	);
}
