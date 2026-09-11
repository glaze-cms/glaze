import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveConfig } from '#config';
import { createInteractiveResolver } from '#convergence';
import { expect, matrixTest } from '#harness';
import { createLogger } from '#logger';
import { resolveRuntime } from '#runtime';

import { materializeApprovalTables } from '../approvals/index.ts';
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
			migrations: { path: migrations },
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

/** The DB-qualified approvals-trail table for the dialect. */
function trailTable(dialect: Dialect): string {
	return dialect === 'postgres' ? 'glaze.approval_events' : 'zz__glaze_approval_events';
}

/** Renders a nullable text column, which arrives as `string | null` from either dialect. */
function stringify(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** Reads the trail oldest-first as `[type, changeHash]` pairs. */
async function readTrail(db: DatabaseHandle, dialect: Dialect): Promise<[string, string][]> {
	const rows = await db.raw(`select id, type, change_hash from ${trailTable(dialect)} order by id`);
	return rows.map((row) => [String(row['type']), stringify(row['change_hash'])]);
}

/** The payload of the newest `requested` event, parsed (SQLite stores JSON as text). */
async function readRequestedPayload(
	db: DatabaseHandle,
	dialect: Dialect,
): Promise<Record<string, unknown>> {
	const rows = await db.raw(
		`select payload from ${trailTable(dialect)} where type = 'requested' order by id desc`,
	);
	const raw = rows[0]?.['payload'];
	return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
}

/** The v1 schema: `posts(id, title, body)`. */
const POSTS_V1 = "id: integer('id').primaryKey(), title: text('title'), body: text('body')";
/** The v2 schema: `body` dropped. */
const POSTS_WITHOUT_BODY = "id: integer('id').primaryKey(), title: text('title')";

/**
 * Applies `posts(id, title, body)` unaudited and inserts a row that fills `body`, so that dropping
 * the column afterwards is a real, measurable loss. Returns the migrations dir the chain lives in.
 */
async function seedPopulatedPosts(
	db: DatabaseHandle,
	dialect: Dialect,
	dir: string,
): Promise<string> {
	const migrations = join(dir, 'migrations');
	const v1 = writeSchema(dir, dialect, POSTS_V1);
	await runConvergence(buildContext(db, dialect, v1, migrations), decliningResolver());
	await db.raw("insert into posts (id, title, body) values (1, 'hi', 'keep me')");
	return migrations;
}

matrixTest('an audited additive change applies and files nothing', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	const migrations = join(dir, 'migrations');
	try {
		// Creating a table destroys nothing, so `audit` has nobody to ask: it applies, and the trail
		// stays empty.
		const context = buildContext(db, dialect, writeSchema(dir, dialect, POSTS_V1), migrations, {
			audit: true,
		});
		await materializeApprovalTables(context);
		await runConvergence(context, decliningResolver());
		expect(await userTableExists(db, dialect, 'posts')).toBe(true);
		expect(await readTrail(db, dialect)).toEqual([]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest(
	'an audited destructive change is filed as pending, and its data survives',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		try {
			const migrations = await seedPopulatedPosts(db, dialect, dir);
			const dropsBody = writeSchema(dir, dialect, POSTS_WITHOUT_BODY);
			const context = buildContext(db, dialect, dropsBody, migrations, { audit: true });
			await materializeApprovalTables(context);

			await runConvergence(context, decliningResolver());

			expect(await db.raw('select body from posts')).toHaveLength(1);
			expect((await readTrail(db, dialect)).map(([type]) => type)).toEqual(['requested']);
			// The request carries what the approver is shown: the count, and the change in words.
			const payload = await readRequestedPayload(db, dialect);
			expect(payload['origin']).toBe('dev');
			expect(payload['unclassified']).toEqual([]);
			expect(payload['description']).toEqual(['drop column posts.body']);
			const findings = payload['findings'] as { code: string; affectedRows: number }[];
			expect(findings.map((finding) => [finding.code, finding.affectedRows])).toEqual([
				['column_has_data', 1],
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

matrixTest(
	'audit decides where a destructive change is answered, never whether',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		try {
			const migrations = await seedPopulatedPosts(db, dialect, dir);
			const dropsBody = writeSchema(dir, dialect, POSTS_WITHOUT_BODY);

			// Audited: filed for the screen; the column stays.
			const audited = buildContext(db, dialect, dropsBody, migrations, { audit: true });
			await materializeApprovalTables(audited);
			await runConvergence(audited, decliningResolver());
			expect(await db.raw('select body from posts')).toHaveLength(1);

			// Unaudited at a terminal with nobody on it: declined, boot fails, the column stays. The
			// message says declined, not unsafe — the change is possible, nobody agreed to it.
			const unaudited = buildContext(db, dialect, dropsBody, migrations, { audit: false });
			let message = '';
			try {
				await runConvergence(unaudited, decliningResolver());
			} catch (error) {
				message = error instanceof Error ? error.message : String(error);
			}
			expect(message).toContain('a destructive change was declined (drop column posts.body)');
			expect(await db.raw('select body from posts')).toHaveLength(1);

			// Unaudited with a person saying yes: applied.
			await runConvergence(unaudited, acceptingResolver('y'));
			let bodyExists = true;
			try {
				await db.raw('select body from posts');
			} catch {
				bodyExists = false;
			}
			expect(bodyExists).toBe(false);
			expect(await db.raw('select title from posts')).toHaveLength(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

matrixTest(
	'an unclassified change at a terminal fails boot and names the operation',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		try {
			const migrations = await seedPopulatedPosts(db, dialect, dir);
			// `text → integer` has no rule in the classifier on either dialect.
			const retyped = writeSchema(
				dir,
				dialect,
				"id: integer('id').primaryKey(), title: text('title'), body: integer('body')",
			);

			let message = '';
			try {
				await runConvergence(buildContext(db, dialect, retyped, migrations), decliningResolver());
			} catch (error) {
				message = error instanceof Error ? error.message : String(error);
			}

			expect(message).toContain('cannot tell whether a change destroys data');
			expect(message).toContain('change column posts.body');
			expect(String((await db.raw('select body from posts'))[0]?.['body'])).toBe('keep me');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

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

matrixTest(
	'files one request per distinct change, and never a duplicate',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		try {
			const migrations = await seedPopulatedPosts(db, dialect, dir);
			const schema = writeSchema(dir, dialect, POSTS_WITHOUT_BODY);
			const context = buildContext(db, dialect, schema, migrations, { audit: true });
			await materializeApprovalTables(context);

			await runConvergence(context, decliningResolver());
			const [filed] = await readTrail(db, dialect);
			expect(filed?.[0]).toBe('requested');
			expect(filed?.[1] === '').toBe(false);

			// A second boot finds the same change. It is already on file and waiting for the same person,
			// so filing it again would turn one decision into a queue of identical ones.
			await runConvergence(context, decliningResolver());
			expect(await readTrail(db, dialect)).toHaveLength(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

matrixTest(
	'supersedes the open request when the schema moves under it',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		try {
			const migrations = await seedPopulatedPosts(db, dialect, dir);
			const dropsBody = writeSchema(dir, dialect, POSTS_WITHOUT_BODY);
			const first = buildContext(db, dialect, dropsBody, migrations, { audit: true });
			await materializeApprovalTables(first);
			await runConvergence(first, decliningResolver());

			// The schema moves: now `title` goes too. A different change, with a different fingerprint.
			const dropsBoth = writeSchema(dir, dialect, "id: integer('id').primaryKey()");
			await runConvergence(
				buildContext(db, dialect, dropsBoth, migrations, { audit: true }),
				decliningResolver(),
			);

			// The first request is closed rather than repositioned: nobody approved the change it now
			// describes, so it is superseded and the new change filed on its own.
			const trail = await readTrail(db, dialect);
			expect(trail.map(([type]) => type)).toEqual(['requested', 'superseded', 'requested']);
			expect(trail[0]?.[1] === trail[2]?.[1]).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

matrixTest('withdraws the open request when the schema is reverted', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const migrations = await seedPopulatedPosts(db, dialect, dir);
		const dropsBody = writeSchema(dir, dialect, POSTS_WITHOUT_BODY);
		const context = buildContext(db, dialect, dropsBody, migrations, { audit: true });
		await materializeApprovalTables(context);
		await runConvergence(context, decliningResolver());

		// Back to a schema the database already satisfies: there is no longer a change to decide on.
		const reverted = writeSchema(dir, dialect, POSTS_V1);
		await runConvergence(
			buildContext(db, dialect, reverted, migrations, { audit: true }),
			decliningResolver(),
		);

		expect((await readTrail(db, dialect)).map(([type]) => type)).toEqual([
			'requested',
			'withdrawn',
		]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest(
	'withdraws the open request when the schema moves to something that applies on its own',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		try {
			const migrations = await seedPopulatedPosts(db, dialect, dir);
			const dropsBody = writeSchema(dir, dialect, POSTS_WITHOUT_BODY);
			const context = buildContext(db, dialect, dropsBody, migrations, { audit: true });
			await materializeApprovalTables(context);
			await runConvergence(context, decliningResolver());

			// The developer keeps `body` after all and adds a column instead: additive, so it applies —
			// and the request on file describes a change nobody is proposing any more.
			const addsNote = writeSchema(dir, dialect, `${POSTS_V1}, note: text('note')`);
			await runConvergence(
				buildContext(db, dialect, addsNote, migrations, { audit: true }),
				decliningResolver(),
			);

			expect(await db.raw('select body, note from posts')).toHaveLength(1);
			expect((await readTrail(db, dialect)).map(([type]) => type)).toEqual([
				'requested',
				'withdrawn',
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

// `audit` decides who says yes, never whether the safety rule applies. A blocking finding is one the
// database itself would reject, so filing it as a pending approval would put an approve button on a
// change that can never succeed — and turn a clean refusal at boot into a failed migration later.
matrixTest(
	'an audited blocking change fails boot instead of being filed',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		const migrations = join(dir, 'migrations');
		try {
			// Apply v1 unaudited, so the snapshot and the database both hold `posts` with a nullable title.
			const v1 = writeSchema(dir, dialect, "id: integer('id').primaryKey(), title: text('title')");
			await runConvergence(buildContext(db, dialect, v1, migrations), decliningResolver());
			await db.raw('insert into posts (id, title) values (1, null)');

			// Now demand NOT NULL, audited. The existing NULL makes this a change the database refuses.
			const v2 = writeSchema(
				dir,
				dialect,
				"id: integer('id').primaryKey(), title: text('title').notNull()",
			);
			const context = buildContext(db, dialect, v2, migrations, { audit: true });
			await materializeApprovalTables(context);

			let threw = false;
			try {
				await runConvergence(context, decliningResolver());
			} catch {
				threw = true;
			}

			expect(threw).toBe(true);
			// Nothing on the trail: the change was refused, not offered to an approver.
			expect(await readTrail(db, dialect)).toHaveLength(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);
