import { sql } from 'drizzle-orm';

import type { DrizzleDatabase } from '../../types/index';

/**
 * Names reserved by Glaze internals or Postgres that cannot be used
 * as collection or field names.
 */
export const GLAZE_RESERVED_NAMES = new Set([
	// Glaze internal tables
	'users',
	'sessions',
	'accounts',
	'verifications',
	'pending_migrations',
	// Postgres system schemas / common reserved words that would cause silent issues
	'public',
	'pg_catalog',
	'information_schema',
	'oid',
	'tableoid',
	'xmin',
	'cmin',
	'xmax',
	'cmax',
	'ctid',
]);

export function isReservedName(name: string): boolean {
	return GLAZE_RESERVED_NAMES.has(name.toLowerCase());
}

// ─── DB checks ────────────────────────────────────────────────────────────────

export async function tableExists(
	db: DrizzleDatabase,
	table: string,
): Promise<boolean> {
	const result = await db.execute(
		sql`SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = ${table}
        LIMIT 1`,
	);
	const rows = 'rows' in result ? result.rows : result;
	return Array.isArray(rows) && rows.length > 0;
}

export async function columnExists(
	db: DrizzleDatabase,
	table: string,
	column: string,
): Promise<boolean> {
	const result = await db.execute(
		sql`SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ${column}
        LIMIT 1`,
	);
	const rows = 'rows' in result ? result.rows : result;
	return Array.isArray(rows) && rows.length > 0;
}

export async function tableIsEmpty(
	db: DrizzleDatabase,
	table: string,
): Promise<boolean> {
	// Use EXISTS for efficiency — stops at first row found
	const result = await db.execute(
		sql`SELECT NOT EXISTS (SELECT 1 FROM ${sql.raw(`"${table}"`)} LIMIT 1) AS empty`,
	);
	const rows = 'rows' in result ? result.rows : result;
	return Boolean((rows as Array<{ empty: boolean }>)[0]?.empty);
}

/**
 * Returns the names of tables that have a foreign key referencing the given table.
 * An empty array means it's safe to drop.
 */
export async function getTableReferences(
	db: DrizzleDatabase,
	table: string,
): Promise<string[]> {
	const result = await db.execute(
		sql`SELECT DISTINCT tc.table_name AS referencing_table
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.referential_constraints AS rc
          ON tc.constraint_name = rc.constraint_name
          AND tc.constraint_schema = rc.constraint_schema
        JOIN information_schema.table_constraints AS ccu
          ON rc.unique_constraint_name = ccu.constraint_name
          AND rc.unique_constraint_schema = ccu.constraint_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_schema = 'public'
          AND ccu.table_name = ${table}`,
	);
	const rows = 'rows' in result ? result.rows : result;
	return (rows as Array<{ referencing_table: string }>).map(
		(r) => r.referencing_table,
	);
}
