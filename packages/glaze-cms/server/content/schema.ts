/**
 * Runtime schema loader: turns the developer's `config.schema` (a path/glob string handed to
 * drizzle-kit for convergence) into the actual Drizzle **table objects** the content API queries. This
 * is the runtime counterpart to convergence's file-based use of the same path — convergence never
 * imports the modules, so the content API does its own import here.
 *
 * Reuses the codebase's established idioms: dynamic `import()` of a resolved file URL (as in
 * `config/loader.ts`), and drizzle's `is(value, PgTable|SQLiteTable)` table filter (as in the dialect
 * adapters). Table identity comes from the dialect-agnostic `getTableName` / `getTableColumns`.
 */

import { readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { getTableConfig as getPgTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { getTableConfig as getSqliteTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';

import type { ResolvedGlazeConfig } from '#config';
import type { Dialect } from '#dialect';
import type { Collection } from './types.ts';
import type { Column, Table } from 'drizzle-orm';

/**
 * Loads the content collections from the configured Drizzle schema. Absent `config.schema` ⇒ no
 * collections (the content router registers nothing).
 *
 * @param config - The resolved Glaze config (schema path/glob + dialect).
 * @returns One {@link Collection} per exported Drizzle table, de-duplicated by name.
 */
export async function loadCollections(config: ResolvedGlazeConfig): Promise<Collection[]> {
	if (!config.schema) return [];

	const files = resolveSchemaFiles(config.schema);
	const modules = await Promise.all(files.map((file) => import(pathToFileURL(file).href)));

	const collections = new Map<string, Collection>();
	for (const module of modules) {
		for (const value of Object.values(module as Record<string, unknown>)) {
			if (!isDrizzleTable(value, config.dialect)) continue;
			const name = getTableName(value);
			if (collections.has(name)) continue;
			const columns = getTableColumns(value);
			const pk = findSingleColumnPk(value, columns, config.dialect);
			collections.set(name, { name, table: value, columns, pk });
		}
	}

	return [...collections.values()];
}

/**
 * Expands `config.schema` to the module files to import: a single file path as-is, or a `dir/*.ext`
 * glob read from its directory (the two documented layouts — a single file or the per-entity dir).
 *
 * @param schemaPath - The configured schema path/glob, relative to the project root.
 * @returns Absolute paths of the schema module files, sorted for determinism.
 */
function resolveSchemaFiles(schemaPath: string): string[] {
	const absolute = resolve(process.cwd(), schemaPath);
	if (!schemaPath.includes('*')) return [absolute];

	const directory = dirname(absolute);
	const extension = basename(absolute).replace(/^\*/, '');
	return readdirSync(directory)
		.filter((file) => file.endsWith(extension) && !file.endsWith('.d.ts'))
		.toSorted()
		.map((file) => join(directory, file));
}

/**
 * Whether an imported value is a Drizzle table for the active dialect. A type guard, so the caller gets
 * a narrowed {@link Table}.
 *
 * @param value - A value exported from a schema module.
 * @param dialect - The active dialect (selects the table class to match).
 * @returns `true` when `value` is a Drizzle table.
 */
function isDrizzleTable(value: unknown, dialect: Dialect): value is Table {
	return dialect === 'postgres' ? is(value, PgTable) : is(value, SQLiteTable);
}

/**
 * Finds a table's single-column primary key, or `undefined` when it has none or a composite one.
 * Considers BOTH declaration styles: an inline `.primaryKey()` (sets `column.primary`) and a table-level
 * `primaryKey({ columns: [...] })` constraint (does NOT set `column.primary` — it lives in the table
 * config), which the inline-only check silently missed. The two are mutually exclusive per table.
 *
 * @param table - The Drizzle table.
 * @param columns - The table's columns keyed by property name.
 * @param dialect - The active dialect (selects the table-config reader).
 * @returns The single primary-key column, or `undefined`.
 */
function findSingleColumnPk(
	table: Table,
	columns: Record<string, Column>,
	dialect: Dialect,
): Column | undefined {
	const inlinePrimaries = Object.values(columns).filter((column) => column.primary);
	const primaries = [...inlinePrimaries, ...tablePrimaryKeyColumns(table, dialect)];
	if (primaries.length !== 1) return undefined;

	// Return the instance from the columns map — `pkPropertyName` (handlers) matches the PK by identity.
	const pkName = primaries[0]?.name;
	return Object.values(columns).find((column) => column.name === pkName) ?? primaries[0];
}

/**
 * Reads a table's table-level primary-key columns (the `primaryKey({ columns })` constraint), via the
 * dialect's `getTableConfig`. Empty when the PK is inline or absent.
 *
 * @param table - The Drizzle table (already known to match the dialect).
 * @param dialect - The active dialect.
 * @returns The columns of any table-level primary-key constraints.
 */
function tablePrimaryKeyColumns(table: Table, dialect: Dialect): Column[] {
	const config =
		dialect === 'postgres'
			? getPgTableConfig(table as PgTable)
			: getSqliteTableConfig(table as SQLiteTable);
	return config.primaryKeys.flatMap((primaryKey) => primaryKey.columns);
}
