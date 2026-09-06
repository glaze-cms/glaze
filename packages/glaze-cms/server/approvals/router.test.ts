import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Elysia } from 'elysia';

import { resolveConfig } from '#config';
import { expect, matrixTest } from '#harness';
import { createLogger } from '#logger';
import { resolveRuntime } from '#runtime';

import { createContentRouter, loadEntities } from '../content/index.ts';
import { runConvergence } from '../convergence/index.ts';
import { resolveOptions } from '../options/index.ts';
import { materializeApprovalTables } from './materializer.ts';
import { createApprovalsRouter } from './router.ts';

import type { DatabaseHandle, Dialect } from '#dialect';
import type { GlazeContext } from '../app/index.ts';
import type { SessionProvider } from '../auth/index.ts';

// Route tier: the real routes, the real store and a real database, with only the session stubbed —
// the same split the content routes use. It exists because Better Auth's rate limiter keys per IP
// and every in-memory request shares one bucket, so a real sign-up per case is not available. The
// one case that genuinely needs a real account lives in `integration.test.ts`.

/** Temp schema fixtures under `node_modules`, so `drizzle-orm/*` resolves from them. */
const TEMP_FIXTURE_PREFIX = join(
	import.meta.dirname,
	'..',
	'..',
	'node_modules',
	'glaze-approvals-router-fixture-',
);

/** Per-process counter giving each written schema a unique filename (generate caches by path). */
let schemaFileCounter = 0;

/** A session provider that always answers with the given account, or with nobody. */
function authStub(userId: string | null): SessionProvider {
	return {
		api: {
			getSession: async () => (userId ? { user: { id: userId }, session: {} } : null),
		},
	};
}

/**
 * Writes a `posts` schema module with the given column body and returns its path.
 *
 * @param dir - The directory to write into.
 * @param dialect - The dialect whose table helper to emit.
 * @param columns - The column DSL, identical across both dialect cores.
 * @returns The written file path.
 */
function writeSchema(dir: string, dialect: Dialect, columns: string): string {
	const path = join(dir, `posts-${schemaFileCounter++}.mjs`);
	const core = dialect === 'postgres' ? 'pg-core' : 'sqlite-core';
	const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
	writeFileSync(
		path,
		`import { ${table}, integer, text } from 'drizzle-orm/${core}';\n` +
			`export const posts = ${table}('posts', { ${columns} });\n`,
	);
	return path;
}

/** Builds a context over the live database. */
function buildContext(
	db: DatabaseHandle,
	dialect: Dialect,
	schema: string,
	migrations: string,
	audit: boolean,
): GlazeContext {
	return {
		db,
		config: resolveConfig({
			dialect,
			connection: 'unused',
			schema,
			migrations: { path: migrations },
			workflow: { audit },
		}),
		options: resolveOptions({}),
		logger: createLogger({ level: 'silent' }),
		runtime: resolveRuntime(),
	};
}

/** A resolver that reports no terminal, so nothing is answered behind the test's back. */
function silentResolver(): Parameters<typeof runConvergence>[1] {
	return {
		resolve: async () => ({ action: 'create' }),
		confirmLoss: () => false,
		confirmDrop: () => false,
	};
}

/** The DB-qualified approvals tables for the dialect. */
function tables(dialect: Dialect): { events: string; principals: string } {
	return dialect === 'postgres'
		? { events: 'glaze.approval_events', principals: 'glaze.principals' }
		: { events: 'zz__glaze_approval_events', principals: 'zz__glaze_principals' };
}

/** Records a principal with the given role, standing in for a sign-up. */
async function givePrincipal(
	db: DatabaseHandle,
	dialect: Dialect,
	userId: string,
	role: string,
): Promise<void> {
	const now = dialect === 'postgres' ? "'1970-01-01'" : '0';
	await db.raw(
		`insert into ${tables(dialect).principals} (user_id, role, created_at) ` +
			`values ('${userId}', '${role}', ${now})`,
	);
}

/** Reads the trail oldest-first as event types. */
async function trail(db: DatabaseHandle, dialect: Dialect): Promise<string[]> {
	const rows = await db.raw(`select id, type from ${tables(dialect).events} order by id`);
	return rows.map((row) => String(row['type']));
}

/** Whether `posts.body` still exists — what approving this change destroys. */
async function bodyExists(db: DatabaseHandle): Promise<boolean> {
	try {
		await db.raw('select body from posts');
		return true;
	} catch {
		return false;
	}
}

/** A context carrying one pending drop of a populated `posts.body`. */
async function seedPendingDrop(
	db: DatabaseHandle,
	dialect: Dialect,
	dir: string,
): Promise<GlazeContext> {
	const migrations = join(dir, 'migrations');
	const withBody = writeSchema(
		dir,
		dialect,
		"id: integer('id').primaryKey(), title: text('title'), body: text('body')",
	);
	const setup = buildContext(db, dialect, withBody, migrations, false);
	await materializeApprovalTables(setup);
	await runConvergence(setup, silentResolver());
	await db.raw("insert into posts (id, title, body) values (1, 'hi', 'precious')");

	const dropsBody = writeSchema(
		dir,
		dialect,
		"id: integer('id').primaryKey(), title: text('title')",
	);
	const audited = buildContext(db, dialect, dropsBody, migrations, true);
	await runConvergence(audited, silentResolver());
	return audited;
}

/** Sends an in-memory JSON request to a router. */
function send(
	app: { handle(request: Request): Promise<Response> },
	method: string,
	path: string,
	body?: unknown,
): Promise<Response> {
	const init: RequestInit = { method };
	if (body !== undefined) {
		init.headers = { 'content-type': 'application/json' };
		init.body = JSON.stringify(body);
	}
	return app.handle(new Request(`http://localhost${path}`, init));
}

/** Reads the open request's id from a list response. */
async function openId(app: { handle(r: Request): Promise<Response> }): Promise<string> {
	const listed = await send(app, 'GET', '/api/pending-approvals');
	const body = (await listed.json()) as { data: { id: string }[] };
	return body.data[0]?.id ?? '';
}

matrixTest('an editor may read a pending change and may not decide it', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const context = await seedPendingDrop(db, dialect, dir);
		await givePrincipal(db, dialect, 'editor-1', 'editor');
		const app = createApprovalsRouter({ context, auth: authStub('editor-1') });

		const listed = await send(app, 'GET', '/api/pending-approvals');
		expect(listed.status).toBe(200);
		const id = await openId(app);

		expect((await send(app, 'POST', `/api/pending-approvals/${id}/approve`)).status).toBe(403);
		expect(
			(await send(app, 'POST', `/api/pending-approvals/${id}/reject`, { reason: 'no' })).status,
		).toBe(403);

		// Refused, and nothing recorded: a decision nobody was allowed to make is not a decision.
		expect(await bodyExists(db)).toBe(true);
		expect(await trail(db, dialect)).toEqual(['requested']);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('an account with no role at all decides nothing', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const context = await seedPendingDrop(db, dialect, dir);
		const app = createApprovalsRouter({ context, auth: authStub('stranger') });

		const id = await openId(app);
		expect((await send(app, 'POST', `/api/pending-approvals/${id}/approve`)).status).toBe(403);
		expect(await bodyExists(db)).toBe(true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('nobody signed in reads nothing and decides nothing', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const context = await seedPendingDrop(db, dialect, dir);
		const app = createApprovalsRouter({ context, auth: authStub(null) });

		expect((await send(app, 'GET', '/api/pending-approvals')).status).toBe(401);
		expect((await send(app, 'POST', '/api/pending-approvals/x/approve')).status).toBe(401);
		expect(await bodyExists(db)).toBe(true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('rejecting records the reason, and demands one', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const context = await seedPendingDrop(db, dialect, dir);
		await givePrincipal(db, dialect, 'admin-1', 'admin');
		const app = createApprovalsRouter({ context, auth: authStub('admin-1') });
		const id = await openId(app);

		// A rejection with no reason makes the trail useless exactly where it matters.
		const empty = await send(app, 'POST', `/api/pending-approvals/${id}/reject`, { reason: '' });
		expect(empty.status).toBe(422);
		expect(await trail(db, dialect)).toEqual(['requested']);

		const rejected = await send(app, 'POST', `/api/pending-approvals/${id}/reject`, {
			reason: 'we still need the body column',
		});
		expect(rejected.status).toBe(200);
		expect(await trail(db, dialect)).toEqual(['requested', 'rejected']);
		expect(await bodyExists(db)).toBe(true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('an id that is not the open request is not found', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const context = await seedPendingDrop(db, dialect, dir);
		await givePrincipal(db, dialect, 'admin-1', 'admin');
		const app = createApprovalsRouter({ context, auth: authStub('admin-1') });

		const wrong = await send(app, 'POST', '/api/pending-approvals/some-other-id/approve');
		expect(wrong.status).toBe(404);
		expect(await bodyExists(db)).toBe(true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// Approving is bound to the change that was shown. If the schema moved underneath, the approval does
// not carry over to whatever it moved to — the request is closed and somebody looks again.
matrixTest('a change that moved since it was filed is not applied', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const context = await seedPendingDrop(db, dialect, dir);
		await givePrincipal(db, dialect, 'admin-1', 'admin');
		const id = await openId(createApprovalsRouter({ context, auth: authStub('admin-1') }));

		// The same request id now sits in front of a schema that drops `title` as well.
		const dropsBoth = writeSchema(dir, dialect, "id: integer('id').primaryKey()");
		const moved = buildContext(db, dialect, dropsBoth, join(dir, 'migrations'), true);
		const app = createApprovalsRouter({ context: moved, auth: authStub('admin-1') });

		const approved = await send(app, 'POST', `/api/pending-approvals/${id}/approve`);
		expect(approved.status).toBe(409);

		// Nothing applied, and the trail says it was overtaken rather than decided.
		expect(await bodyExists(db)).toBe(true);
		expect(await trail(db, dialect)).toEqual(['requested', 'superseded']);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// The reservation is what stops a user table called `pending-approvals` from registering
// `/api/pending-approvals` and `/:id` and putting content CRUD where approve and reject live. Proved
// against both routers composed together, in the order the app mounts them.
matrixTest(
	'a user table named pending-approvals cannot shadow these routes',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		try {
			const context = await seedPendingDrop(db, dialect, dir);
			await givePrincipal(db, dialect, 'admin-1', 'admin');
			const auth = authStub('admin-1');

			const [posts] = await loadEntities(context.config);
			if (!posts) throw new Error('expected the posts entity');
			const app = new Elysia()
				.use(
					createContentRouter({
						context,
						auth,
						entities: [{ ...posts, name: 'pending-approvals' }],
					}),
				)
				.use(createApprovalsRouter({ context, auth }));

			// The approvals list answers, not a content collection: one open request, with its findings.
			const listed = await send(app, 'GET', '/api/pending-approvals');
			expect(listed.status).toBe(200);
			const body = (await listed.json()) as { data: { id: string; findings: unknown[] }[] };
			expect(body.data).toHaveLength(1);
			expect(body.data[0]?.findings).toHaveLength(1);

			// Mount order alone would win the list route, so that is not what this proves. The
			// reservation is what stops content registering its OTHER verbs on the same prefix:
			// without it, this POST creates a row in a table called `pending-approvals` and answers 201.
			expect((await send(app, 'POST', '/api/pending-approvals', { title: 'hi' })).status).toBe(404);
			expect((await send(app, 'DELETE', '/api/pending-approvals/1')).status).toBe(404);

			// And the child route is still the decision, not a content row by id.
			const id = body.data[0]?.id ?? '';
			expect(
				(await send(app, 'POST', `/api/pending-approvals/${id}/reject`, { reason: 'no' })).status,
			).toBe(200);
			expect(await trail(db, dialect)).toEqual(['requested', 'rejected']);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);
