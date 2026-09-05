import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveConfig } from '#config';
import { createInteractiveResolver } from '#convergence';
import { expect, matrixTest } from '#harness';
import { createLogger } from '#logger';
import { resolveRuntime } from '#runtime';

import { materializeAuthTables } from '../auth/index.ts';
import { resolveOptions } from '../options/index.ts';
import { runConvergence } from './runner.ts';

import type { WorkflowConfig } from '#config';
import type { InteractiveResolver } from '#convergence';
import type { DatabaseHandle, Dialect } from '#dialect';
import type { GlazeContext } from '../app/context.ts';

/**
 * The parent path for per-test temp schema files, placed under the package's `node_modules` so a
 * written `schema.ts` can resolve its `drizzle-orm/*` imports (module resolution walks up to
 * node_modules), while staying out of the tsc/lint/format globs. Each test makes an isolated
 * subdirectory here and removes it afterward. Test-only — never part of the shipped package.
 */
const TEMP_FIXTURE_PREFIX = join(
	import.meta.dirname,
	'..',
	'..',
	'node_modules',
	'glaze-convergence-fixture-',
);

/** A resolver that reports a non-interactive terminal, so every decision fails closed (declines). */
function decliningResolver(): InteractiveResolver {
	return createInteractiveResolver({ ask: async () => '', isTty: () => false });
}

/**
 * A resolver that reports an interactive terminal and answers every prompt with `answer`. Used to
 * drive the *confirming* paths (a confirmed drop, a rename carrying data) so a mis-wired seam — e.g.
 * `confirmDrop` routed where `confirmLoss` belongs — fails a test instead of passing on a uniform "no".
 */
function acceptingResolver(answer: string): InteractiveResolver {
	return createInteractiveResolver({ ask: async () => answer, isTty: () => true });
}

/** Per-process counter giving each written schema a unique filename (see {@link writeSchema}). */
let schemaFileCounter = 0;

/**
 * Writes a Drizzle schema file declaring a `posts` table with the given column body, and returns its
 * path. Each call uses a **fresh filename**: drizzle-kit's `generate` imports the schema module once
 * and caches it by path, so a test that evolves the schema across multiple `generate` calls (in one
 * process) must point each run at a new file to be re-read. The shared `out` dir still links the
 * snapshot chain. The column DSL (`integer`/`text`/`primaryKey`) is identical across pg-core and
 * sqlite-core, so only the import and table helper differ by dialect.
 */
function writeSchema(dir: string, dialect: Dialect, columns: string): string {
	const path = join(dir, `schema-${schemaFileCounter++}.ts`);
	const core = dialect === 'postgres' ? 'pg-core' : 'sqlite-core';
	const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
	writeFileSync(
		path,
		`import { ${table}, integer, text } from 'drizzle-orm/${core}';\n` +
			`export const posts = ${table}('posts', { ${columns} });\n`,
	);
	return path;
}

/** Builds a Glaze context whose config points at the given schema file and migrations dir. */
function buildContext(
	db: DatabaseHandle,
	dialect: Dialect,
	schema: string,
	migrations: string,
	workflow: WorkflowConfig = {},
): GlazeContext {
	return {
		db,
		config: resolveConfig({
			dialect,
			connection: 'unused',
			schema,
			migrations,
			workflow,
		}),
		options: resolveOptions({}),
		logger: createLogger({ level: 'silent' }),
		runtime: resolveRuntime(),
	};
}

/** Whether a user table exists in the public/default namespace (not an internal Glaze table). */
async function userTableExists(
	db: DatabaseHandle,
	dialect: Dialect,
	name: string,
): Promise<boolean> {
	const sql =
		dialect === 'postgres'
			? `select 1 from information_schema.tables where table_schema = 'public' and table_name = '${name}'`
			: `select 1 from sqlite_master where type = 'table' and name = '${name}'`;
	return (await db.raw(sql)).length > 0;
}

/** How many of Glaze's internal auth tables are present (4 once materialized). */
async function authTableCount(db: DatabaseHandle, dialect: Dialect): Promise<number> {
	const sql =
		dialect === 'postgres'
			? "select table_name from information_schema.tables where table_schema = 'glaze_auth'"
			: "select name from sqlite_master where type = 'table' and name like 'zz__glaze_auth_%'";
	return (await db.raw(sql)).length;
}

matrixTest(
	'converges the config schema at boot, without touching the internal auth tables',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		try {
			const schema = writeSchema(
				dir,
				dialect,
				"id: integer('id').primaryKey(), title: text('title')",
			);
			const context = buildContext(db, dialect, schema, join(dir, 'migrations'));

			await materializeAuthTables(context);
			await runConvergence(context, decliningResolver());

			expect(await userTableExists(db, dialect, 'posts')).toBe(true);
			expect(await authTableCount(db, dialect)).toBe(4);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

matrixTest('re-running the same schema is a no-op that preserves data', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	const migrations = join(dir, 'migrations');
	try {
		const cols = "id: integer('id').primaryKey(), title: text('title')";
		await runConvergence(
			buildContext(db, dialect, writeSchema(dir, dialect, cols), migrations),
			decliningResolver(),
		);
		await db.raw("insert into posts (id, title) values (1, 'hello')");
		// A second converge against an identical (but freshly-written) schema must detect no changes.
		await runConvergence(
			buildContext(db, dialect, writeSchema(dir, dialect, cols), migrations),
			decliningResolver(),
		);

		const rows = await db.raw('select title from posts');
		expect(rows).toHaveLength(1);
		expect(String(rows[0]?.['title'])).toBe('hello');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('an additive column change applies at boot', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	const migrations = join(dir, 'migrations');
	try {
		const v1 = writeSchema(dir, dialect, "id: integer('id').primaryKey(), title: text('title')");
		await runConvergence(buildContext(db, dialect, v1, migrations), decliningResolver());

		const v2 = writeSchema(
			dir,
			dialect,
			"id: integer('id').primaryKey(), title: text('title'), body: text('body')",
		);
		await runConvergence(buildContext(db, dialect, v2, migrations), decliningResolver());

		// The new column is usable — an insert naming it succeeds.
		await db.raw("insert into posts (id, title, body) values (1, 'hi', 'text')");
		const rows = await db.raw('select body from posts where id = 1');
		expect(String(rows[0]?.['body'])).toBe('text');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest(
	'a populated column drop under a non-interactive boot blocks and keeps the data',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		const migrations = join(dir, 'migrations');
		try {
			const v1 = writeSchema(
				dir,
				dialect,
				"id: integer('id').primaryKey(), title: text('title'), body: text('body')",
			);
			await runConvergence(buildContext(db, dialect, v1, migrations), decliningResolver());
			await db.raw("insert into posts (id, title, body) values (1, 'hi', 'keep me')");

			// Drop the populated `body` column; a non-interactive boot must decline and fail closed.
			const v2 = writeSchema(dir, dialect, "id: integer('id').primaryKey(), title: text('title')");
			let threw = false;
			try {
				await runConvergence(buildContext(db, dialect, v2, migrations), decliningResolver());
			} catch {
				threw = true;
			}

			expect(threw).toBe(true);
			// The column and its data survive — the drop never applied.
			const rows = await db.raw('select body from posts where id = 1');
			expect(rows).toHaveLength(1);
			expect(String(rows[0]?.['body'])).toBe('keep me');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

matrixTest(
	'a confirmed populated column drop applies (confirmDrop is wired to the drop)',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		const migrations = join(dir, 'migrations');
		try {
			const v1 = writeSchema(
				dir,
				dialect,
				"id: integer('id').primaryKey(), title: text('title'), body: text('body')",
			);
			await runConvergence(buildContext(db, dialect, v1, migrations), decliningResolver());
			await db.raw("insert into posts (id, title, body) values (1, 'hi', 'drop me')");

			// 'y' confirms the populated-drop the pre-flight surfaces, so the drop proceeds.
			const v2 = writeSchema(dir, dialect, "id: integer('id').primaryKey(), title: text('title')");
			await runConvergence(buildContext(db, dialect, v2, migrations), acceptingResolver('y'));

			// The column is gone but the row survives — only `body` was dropped.
			const rows = await db.raw('select * from posts where id = 1');
			expect(rows).toHaveLength(1);
			expect('body' in (rows[0] ?? {})).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

matrixTest(
	'a confirmed column rename carries the data across (resolve is wired to the rename)',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		const migrations = join(dir, 'migrations');
		try {
			const v1 = writeSchema(dir, dialect, "id: integer('id').primaryKey(), body: text('body')");
			await runConvergence(buildContext(db, dialect, v1, migrations), decliningResolver());
			await db.raw("insert into posts (id, body) values (1, 'keep me')");

			// Answer the rename-or-create with the OLD column name, so drizzle renames body -> bio.
			const v2 = writeSchema(dir, dialect, "id: integer('id').primaryKey(), bio: text('bio')");
			await runConvergence(buildContext(db, dialect, v2, migrations), acceptingResolver('body'));

			const rows = await db.raw('select bio from posts where id = 1');
			expect(rows).toHaveLength(1);
			expect(String(rows[0]?.['bio'])).toBe('keep me');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

matrixTest(
	'an audited change is detected as pending without being applied',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		const migrations = join(dir, 'migrations');
		try {
			const schema = writeSchema(
				dir,
				dialect,
				"id: integer('id').primaryKey(), title: text('title')",
			);
			// `audit` is the team default: converge returns `pending` and rolls back — boot continues, but
			// the table is NOT created (no durable record yet, so this is a deliberate no-op-that-continues).
			await runConvergence(
				buildContext(db, dialect, schema, migrations, { mode: 'team' }),
				decliningResolver(),
			);
			expect(await userTableExists(db, dialect, 'posts')).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

matrixTest('auditing is configurable independently of the mode', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const schema = writeSchema(
			dir,
			dialect,
			"id: integer('id').primaryKey(), title: text('title')",
		);

		// solo + audit: alone, but every structural change is still held for review.
		await runConvergence(
			buildContext(db, dialect, schema, join(dir, 'audited'), { mode: 'solo', audit: true }),
			decliningResolver(),
		);
		expect(await userTableExists(db, dialect, 'posts')).toBe(false);

		// A team audits by default, so opting out of it must actually reach the apply path.
		await runConvergence(
			buildContext(db, dialect, schema, join(dir, 'unaudited'), { mode: 'team', audit: false }),
			decliningResolver(),
		);
		expect(await userTableExists(db, dialect, 'posts')).toBe(true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('skips convergence entirely when no schema is configured', async ({ db, dialect }) => {
	// A config without `schema` resolves to `undefined`; runConvergence must return without touching the DB.
	const context: GlazeContext = {
		db,
		config: resolveConfig({ dialect, connection: 'unused' }),
		options: resolveOptions({}),
		logger: createLogger({ level: 'silent' }),
		runtime: resolveRuntime(),
	};
	await runConvergence(context, decliningResolver());
	expect(await userTableExists(db, dialect, 'posts')).toBe(false);
});
