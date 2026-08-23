/** Shared content-API types. */

import type { Column, Table } from 'drizzle-orm';

/** A single-column foreign key: the entity and column it points at. */
export interface ColumnReference {
	/** The referenced table's name. */
	readonly entity: string;
	/** The referenced column's database name. */
	readonly column: string;
}

/**
 * One content entity derived from a Drizzle table: the queryable table object, its columns (for
 * body filtering), the single-column primary key when the table has one, and its foreign keys. A
 * entity without a single-column PK serves list + create only (no by-id routes).
 */
export interface Entity {
	/** The entity name — the Drizzle table name; the `/api/{name}` route segment. */
	readonly name: string;
	/** The Drizzle table object, passed to the query builder. */
	readonly table: Table;
	/** The table's columns, keyed by property name — used to filter incoming request bodies. */
	readonly columns: Record<string, Column>;
	/** The single-column primary key, or `undefined` when the table has none (or a composite one). */
	readonly pk: Column | undefined;
	/**
	 * Every primary-key column's property name, however the key was declared. Unlike {@link pk} this
	 * survives a composite key, which is what tells a junction table (a key made entirely of foreign
	 * keys) from an ordinary table.
	 */
	readonly primaryKeyColumns: readonly string[];
	/**
	 * Single-column foreign keys, keyed by the referencing column's property name. Composite foreign
	 * keys are omitted — they have no single-field representation in the descriptor. Read here rather
	 * than downstream so all dialect-specific table-config access stays in the loader.
	 */
	readonly references: Record<string, ColumnReference>;
}
