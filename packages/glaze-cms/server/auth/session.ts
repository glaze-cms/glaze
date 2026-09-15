/**
 * Reading the account behind a request from the session **table**, not the cookie cache.
 *
 * The shared `{ auth: true }` macro accepts the signed session-data cookie for a few minutes after
 * sign-out, which is fine for reading content and not fine for a write that changes who may do what
 * or what the database holds. Those routes ask Better Auth to look the session up.
 */

import type { SessionProvider } from './macro.ts';

/** Who is asking: a live account, nobody, or a session Glaze cannot read an account out of. */
export type FreshSession =
	| { readonly kind: 'user'; readonly id: string }
	| { readonly kind: 'none' }
	| { readonly kind: 'malformed' };

/**
 * Resolves the signed-in account from the session table.
 *
 * @param auth - The Better Auth instance.
 * @param headers - The request headers (cookie or bearer token).
 * @returns The account id; `none` when there is no live session; `malformed` when there is one but it
 *   carries no usable id, which is a server fault rather than the caller's.
 */
export async function resolveFreshSession(
	auth: SessionProvider,
	headers: Headers,
): Promise<FreshSession> {
	const result = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
	if (!result) return { kind: 'none' };
	const id = (result.user as { id?: unknown } | null)?.id;
	return typeof id === 'string' && id.length > 0 ? { kind: 'user', id } : { kind: 'malformed' };
}
