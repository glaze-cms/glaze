/**
 * Live-database introspection for the apply oracle. Listing user tables is one of the few genuinely
 * dialect-specific operations (CLAUDE.md §5 explicitly scopes introspection quirks to the dialect
 * concern), so the single `switch` here is deliberate and isolated — the rest of convergence stays
 * dialect-agnostic.
 */

import type { Dialect, RawExecutor } from '../../dialect/index.ts';

/** A user table the oracle counts: its name, and the schema to qualify it with (SQLite has none). */
export interface UserTable {
	/** The schema to qualify the count with (`public` on Postgres; `undefined` on SQLite). */
	readonly schema: string | undefined;
	/** The (unqualified) table name — the key the before/after oracle matches on. */
	readonly name: string;
}

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
 * table. Each table carries the schema its count must be qualified with, so the count targets exactly
 * the relation listed here rather than one resolved through the connection's `search_path`.
 *
 * **Scope (Postgres):** only the `public` schema. Tables in other schemas are not counted, so this
 * oracle does not protect them — a documented limitation until convergence supports multi-schema
 * introspection (which is also where the Glaze internal schemas will be excluded).
 *
 * @param query - A query executor (typically transaction-bound during apply).
 * @param dialect - The target dialect; selects the introspection query.
 * @returns The user tables, each with the schema to qualify its count with.
 */
export async function listUserTables(query: RawExecutor, dialect: Dialect): Promise<UserTable[]> {
	const schema = dialect === 'postgres' ? 'public' : undefined;
	const introspection =
		dialect === 'postgres'
			? `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
			: `SELECT name FROM sqlite_master WHERE type = 'table'`;

	const rows = await query(introspection);

	return rows
		.map((row) => String(row.name))
		.filter((name) => !isMetaTable(name))
		.map((name) => ({ schema, name }));
}
