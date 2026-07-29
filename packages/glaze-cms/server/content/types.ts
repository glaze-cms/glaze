/** Shared content-API types. */

import type { Column, Table } from 'drizzle-orm';

/**
 * One content collection derived from a Drizzle table: the queryable table object, its columns (for
 * body filtering), and the single-column primary key when the table has one. A collection without a
 * single-column PK serves list + create only (no by-id routes).
 */
export interface Collection {
	/** The collection name — the Drizzle table name; the `/api/{name}` route segment. */
	readonly name: string;
	/** The Drizzle table object, passed to the query builder. */
	readonly table: Table;
	/** The table's columns, keyed by property name — used to filter incoming request bodies. */
	readonly columns: Record<string, Column>;
	/** The single-column primary key, or `undefined` when the table has none (or a composite one). */
	readonly pk: Column | undefined;
}
