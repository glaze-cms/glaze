/**
 * Maps Glaze's dialect onto the provider string Better Auth's `drizzleAdapter` expects. The dialect
 * seam names dialects `postgres`/`sqlite`; Better Auth names the Postgres provider `pg`.
 */

import type { Dialect } from '#dialect';

/** The provider identifiers Better Auth's `drizzleAdapter` accepts for Glaze's two dialects. */
export type AuthProvider = 'pg' | 'sqlite';

/**
 * Resolves the Better Auth adapter provider for a dialect.
 *
 * @param dialect - The Glaze database dialect.
 * @returns The provider string for Better Auth's `drizzleAdapter`.
 */
export function resolveAuthProvider(dialect: Dialect): AuthProvider {
	return dialect === 'postgres' ? 'pg' : 'sqlite';
}
