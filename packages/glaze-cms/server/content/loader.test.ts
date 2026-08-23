import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveConfig } from '#config';
import { expect, test } from '#harness';

import { loadEntities } from './loader.ts';

import type { GlazeConfig } from '#config';
import type { Dialect } from '#dialect';

/**
 * The parent path for per-test temp schema files, under the package's `node_modules` so a written
 * schema can resolve its `drizzle-orm/*` imports (module resolution walks up to node_modules), while
 * staying out of the tsc/lint/format globs. Mirrors the convergence runner test. Test-only.
 */
const TEMP_FIXTURE_PREFIX = join(
	import.meta.dirname,
	'..',
	'..',
	'node_modules',
	'glaze-content-fixture-',
);

/**
 * Writes a Drizzle schema module declaring one table, and returns its path. The `integer`/`text` DSL is
 * identical across pg-core and sqlite-core, so only the import + table helper differ by dialect. Emitted
 * as `.mjs` (the DSL carries no type annotations) so both runtimes import it natively — Node refuses to
 * type-strip a `.ts` file living under `node_modules`, where the fixture must sit to resolve `drizzle-orm`.
 *
 * @param dir - The directory to write into.
 * @param dialect - The dialect whose table helper/import to emit.
 * @param name - The table (and export) name.
 * @param body - The column DSL body.
 * @returns The written file path.
 */
function writeSchema(dir: string, dialect: Dialect, name: string, body: string): string {
	const path = join(dir, `${name}.mjs`);
	const core = dialect === 'postgres' ? 'pg-core' : 'sqlite-core';
	const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
	writeFileSync(
		path,
		`import { ${table}, integer, text } from 'drizzle-orm/${core}';\n` +
			`export const ${name} = ${table}('${name}', { ${body} });\n`,
	);
	return path;
}

/**
 * Builds a resolved config pointing at a schema path (or none).
 *
 * @param dialect - The dialect.
 * @param schema - The schema path/glob, or `undefined`.
 * @returns The resolved config.
 */
function buildConfig(dialect: Dialect, schema: string | undefined) {
	const base: GlazeConfig = { dialect, connection: 'unused' };
	return resolveConfig(schema === undefined ? base : { ...base, schema });
}

test('loadEntities derives an entity with columns and a single-column PK', async () => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const schema = writeSchema(
			dir,
			'sqlite',
			'posts',
			"id: integer('id').primaryKey(), title: text('title')",
		);
		const entities = await loadEntities(buildConfig('sqlite', schema));

		expect(entities).toHaveLength(1);
		expect(entities[0]?.name).toBe('posts');
		expect(Object.keys(entities[0]?.columns ?? {})).toEqual(['id', 'title']);
		expect(entities[0]?.pk?.name).toBe('id');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('loadEntities derives a table-level single-column PK', async () => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		// A PK declared table-level via `primaryKey({ columns })` does NOT set `column.primary`; the
		// loader must read it from the table config, or the by-id routes are silently dropped.
		const path = join(dir, 'posts.mjs');
		writeFileSync(
			path,
			"import { sqliteTable, integer, text, primaryKey } from 'drizzle-orm/sqlite-core';\n" +
				"export const posts = sqliteTable('posts', { id: integer('id'), title: text('title') }, " +
				'(t) => [primaryKey({ columns: [t.id] })]);\n',
		);
		const entities = await loadEntities(buildConfig('sqlite', path));

		expect(entities[0]?.pk?.name).toBe('id');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('loadEntities leaves a table without a single-column PK unkeyed', async () => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const schema = writeSchema(dir, 'sqlite', 'tags', "a: text('a'), b: text('b')");
		const entities = await loadEntities(buildConfig('sqlite', schema));

		expect(entities).toHaveLength(1);
		expect(entities[0]?.pk).toEqual(undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('loadEntities returns nothing when no schema is configured', async () => {
	expect(await loadEntities(buildConfig('sqlite', undefined))).toHaveLength(0);
});

test('loadEntities expands a directory glob to every module', async () => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		writeSchema(dir, 'sqlite', 'posts', "id: integer('id').primaryKey()");
		writeSchema(dir, 'sqlite', 'tags', "id: integer('id').primaryKey()");
		const entities = await loadEntities(buildConfig('sqlite', join(dir, '*.mjs')));

		expect(entities.map((entity) => entity.name).toSorted()).toEqual(['posts', 'tags']);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('loadEntities keeps only the active dialect tables', async () => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const schema = writeSchema(dir, 'postgres', 'posts', "id: integer('id').primaryKey()");
		expect(await loadEntities(buildConfig('postgres', schema))).toHaveLength(1);
		// The same Postgres table module, read as SQLite, matches no SQLite table.
		expect(await loadEntities(buildConfig('sqlite', schema))).toHaveLength(0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
