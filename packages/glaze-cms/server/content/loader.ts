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
import type { Entity, ColumnReference } from './types.ts';
import type { Column, Table } from 'drizzle-orm';

/**
 * Loads the content entities from the configured Drizzle schema. Absent `config.schema` ⇒ no
 * entities (the content router registers nothing).
 *
 * @param config - The resolved Glaze config (schema path/glob + dialect).
 * @returns One {@link Entity} per exported Drizzle table, de-duplicated by name.
 */
export async function loadEntities(config: ResolvedGlazeConfig): Promise<Entity[]> {
	if (!config.schema) return [];

	const files = resolveSchemaFiles(config.schema);
	const modules = await Promise.all(files.map((file) => import(pathToFileURL(file).href)));

	const entities = new Map<string, Entity>();
	for (const module of modules) {
		for (const value of Object.values(module as Record<string, unknown>)) {
			if (!isDrizzleTable(value, config.dialect)) continue;
			const name = getTableName(value);
			if (entities.has(name)) continue;
			const columns = getTableColumns(value);
			const pk = findSingleColumnPk(value, columns, config.dialect);
			const primaryKeyColumns = findPrimaryKeyColumns(value, columns, config.dialect);
			const references = findReferences(value, columns, config.dialect);
			entities.set(name, { name, table: value, columns, pk, primaryKeyColumns, references });
		}
	}

	return [...entities.values()];
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
	return readTableConfig(table, dialect).primaryKeys.flatMap((primaryKey) => primaryKey.columns);
}

/**
 * Reads the dialect's table config. The single place a dialect branch is needed for table metadata:
 * `getTableConfig` is dialect-specific by construction, so every caller that needs constraints goes
 * through here rather than branching itself.
 *
 * @param table - The Drizzle table (already known to match the dialect).
 * @param dialect - The active dialect.
 * @returns The table's config, whose `primaryKeys` and `foreignKeys` are shaped alike per dialect.
 */
function readTableConfig(table: Table, dialect: Dialect) {
	return dialect === 'postgres'
		? getPgTableConfig(table as PgTable)
		: getSqliteTableConfig(table as SQLiteTable);
}

/**
 * Lists every primary-key column's property name, from both declaration styles. Unlike
 * {@link findSingleColumnPk} this keeps composite keys, which is how a junction table is recognised.
 *
 * @param table - The Drizzle table.
 * @param columns - The table's columns keyed by property name.
 * @param dialect - The active dialect.
 * @returns The property names of the primary-key columns, empty when the table has no key.
 */
function findPrimaryKeyColumns(
	table: Table,
	columns: Record<string, Column>,
	dialect: Dialect,
): string[] {
	const primaries = [
		...Object.values(columns).filter((column) => column.primary),
		...tablePrimaryKeyColumns(table, dialect),
	];
	const names = new Set(primaries.map((column) => column.name));
	return Object.entries(columns)
		.filter(([, column]) => names.has(column.name))
		.map(([key]) => key);
}

/**
 * Maps a table's single-column foreign keys to the property name of the referencing column. Composite
 * foreign keys are skipped: they have no single-field representation, and treating one of their columns
 * as a standalone reference would misdescribe the relationship.
 *
 * @param table - The Drizzle table.
 * @param columns - The table's columns keyed by property name.
 * @param dialect - The active dialect.
 * @returns References keyed by referencing property name.
 */
function findReferences(
	table: Table,
	columns: Record<string, Column>,
	dialect: Dialect,
): Record<string, ColumnReference> {
	const byColumnName = new Map(Object.entries(columns).map(([key, column]) => [column.name, key]));
	const references: Record<string, ColumnReference> = {};

	for (const foreignKey of readTableConfig(table, dialect).foreignKeys) {
		const { columns: local, foreignTable, foreignColumns } = foreignKey.reference();
		if (local.length !== 1) continue;

		const key = byColumnName.get(local[0]?.name ?? '');
		const target = foreignColumns[0];
		if (!key || !target) continue;

		references[key] = { entity: getTableName(foreignTable), column: target.name };
	}

	return references;
}
