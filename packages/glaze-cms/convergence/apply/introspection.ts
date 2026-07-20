/**
 * Live-database introspection for the apply oracle. Listing user tables is one of the few genuinely
 * dialect-specific operations (CLAUDE.md §5 explicitly scopes introspection quirks to the dialect
 * concern), so the single `switch` here is deliberate and isolated — the rest of convergence stays
 * dialect-agnostic.
 */

import type { Dialect, RawExecutor } from '../../dialect/index.ts';

/**
 * Reports whether a table is bookkeeping rather than user data. Uses **exact** matching for the
 * migration table and only the genuinely reserved `sqlite_` prefix — a broad `startsWith` would hide
 * legitimately-named user tables (e.g. `__drizzle_cache`), turning their loss into a false "safe".
 */
function isMetaTable(name: string): boolean {
	return name === '__drizzle_migrations' || name.startsWith('sqlite_');
}

/**
 * Lists the user (base) tables the oracle counts. Excludes reserved catalogs and the migration
 * table.
 *
 * **Scope (Postgres):** only the `public` schema. Tables in other schemas are not counted, so this
 * oracle does not protect them — a documented limitation until convergence supports multi-schema
 * introspection (the query would need schema-qualified counting).
 *
 * @param query - A query executor (typically transaction-bound during apply).
 * @param dialect - The target dialect; selects the introspection query.
 * @returns The user table names.
 */
export async function listUserTables(query: RawExecutor, dialect: Dialect): Promise<string[]> {
	const introspection =
		dialect === 'postgres'
			? `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
			: `SELECT name FROM sqlite_master WHERE type = 'table'`;

	const rows = await query(introspection);

	return rows.map((row) => String(row.name)).filter((name) => !isMetaTable(name));
}
