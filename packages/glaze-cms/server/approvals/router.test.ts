import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Elysia } from 'elysia';

import { resolveConfig } from '#config';
import { createInteractiveResolver } from '#convergence';
import { expect, matrixTest, nextSecond } from '#harness';
import { createLogger } from '#logger';
import { resolveRuntime } from '#runtime';

import { createContentRouter, loadEntities } from '../content/index.ts';
import { runConvergence } from '../convergence/index.ts';
import { resolveOptions } from '../options/index.ts';
import { materializeApprovalTables } from './materializer.ts';
import { createApprovalsRouter } from './router.ts';
import { buildApprovalSchema } from './schema/index.ts';
import { claimFirstAdmin } from './store.ts';

import type { InteractiveResolver } from '#convergence';
import type { DatabaseHandle, Dialect } from '#dialect';
import type { GlazeContext } from '../app/context.ts';
import type { SessionProvider } from '../auth/index.ts';
import type { ApprovalDb } from './store.ts';
import type { Table } from 'drizzle-orm';

// The approve path end to end: real audited boots file real requests, real converges apply them,
// and the trail and the database are asserted after every decision. Sessions are stubbed; nothing
// here signs up over HTTP.

/** Temp schema fixtures under `node_modules` so `drizzle-orm/*` resolves; see the loader test. */
const TEMP_FIXTURE_PREFIX = join(
	import.meta.dirname,
	'..',
	'..',
	'node_modules',
	'glaze-approvals-fixture-',
);

/** A minimal Elysia app, enough to `handle` requests. */
interface Handler {
	handle(request: Request): Promise<Response>;
}

/** The `{ success, data, error }` envelope every response carries. */
interface Envelope {
	success: boolean;
	data: unknown;
	error: { code: string; message: string } | null;
}

/** One entry of the pending-approvals list, as far as these tests read it. */
interface Listed {
	id: string;
	changeHash: string;
	description: string[];
	statements: string[];
	findings: {
		change: { kind: string; table: string; column?: string };
		code: string;
		affectedRows: number | null;
	}[];
	findingsHash: string;
	unclassified: unknown[];
	decisions: unknown[];
}

/** A resolver that reports a non-interactive terminal, so every decision fails closed (declines). */
function decliningResolver(): InteractiveResolver {
	return createInteractiveResolver({ ask: async () => '', isTty: () => false });
}

/** Per-process counter giving each written schema a unique filename. */
let schemaFileCounter = 0;

/** Writes a Drizzle schema file declaring `posts` with the given columns, on a fresh path. */
function writeSchema(dir: string, dialect: Dialect, columns: string, name = 'posts'): string {
	const path = join(dir, `schema-${schemaFileCounter++}.ts`);
	const core = dialect === 'postgres' ? 'pg-core' : 'sqlite-core';
	const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
	writeFileSync(
		path,
		`import { ${table}, integer, numeric, text } from 'drizzle-orm/${core}';\n` +
			`export const ${name} = ${table}('${name}', { ${columns} });\n`,
	);
	return path;
}

/** Builds a Glaze context over the harness database, audited. */
function buildContext(
	db: DatabaseHandle,
	dialect: Dialect,
	schema: string,
	migrations: string,
): GlazeContext {
	return {
		db,
		config: resolveConfig({
			dialect,
			connection: 'unused',
			schema,
			migrations: { path: migrations },
			workflow: { audit: true },
		}),
		options: resolveOptions({}),
		logger: createLogger({ level: 'silent' }),
		runtime: resolveRuntime(),
	};
}

/** A stub Better Auth instance resolving the given account, or nobody. */
function authStub(userId: string | null): SessionProvider {
	const session = userId ? { user: { id: userId }, session: { id: `s-${userId}` } } : null;
	return { api: { getSession: async () => session } };
}

/** Sends an in-memory request, JSON body optional. */
function send(app: Handler, method: string, path: string, body?: unknown): Promise<Response> {
	const init: RequestInit =
		body === undefined
			? { method }
			: { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
	return app.handle(new Request(`http://localhost${path}`, init));
}

/** Parses a response as the API envelope, surfacing status + raw text when it is not JSON. */
async function toEnvelope(response: Response): Promise<Envelope> {
	const text = await response.text();
	try {
		return JSON.parse(text) as Envelope;
	} catch {
		throw new Error(`expected a JSON envelope, got ${response.status}: ${text.slice(0, 160)}`);
	}
}

/** The DB-qualified approvals-trail table for the dialect. */
function trailTable(dialect: Dialect): string {
	return dialect === 'postgres' ? 'glaze.approval_events' : 'zz__glaze_approval_events';
}

/** Reads the trail oldest-first as `[type, actorId]` pairs. */
async function readTrail(db: DatabaseHandle, dialect: Dialect): Promise<[string, string | null][]> {
	const rows = await db.raw(`select id, type, actor_id from ${trailTable(dialect)} order by id`);
	return rows.map((row) => {
		const actor = row['actor_id'];
		return [String(row['type']), typeof actor === 'string' ? actor : null];
	});
}

/** The payload of the newest event of a type, parsed. */
async function readLatestPayload(
	db: DatabaseHandle,
	dialect: Dialect,
	type: string,
): Promise<Record<string, unknown>> {
	const rows = await db.raw(
		`select payload from ${trailTable(dialect)} where type = '${type}' order by id desc`,
	);
	const raw = rows[0]?.['payload'];
	return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
}

/** Whether a column can be selected. */
async function columnExists(db: DatabaseHandle, table: string, column: string): Promise<boolean> {
	try {
		await db.raw(`select ${column} from ${table}`);
		return true;
	} catch {
		return false;
	}
}

const POSTS_V1 = "id: integer('id').primaryKey(), title: text('title'), body: text('body')";
const POSTS_WITHOUT_BODY = "id: integer('id').primaryKey(), title: text('title')";

/** Everything one scenario needs: a seeded, populated `posts`, an admin, and the routes. */
interface Scenario {
	readonly dir: string;
	readonly migrations: string;
	/** Boots audited with the given schema, as the server would. */
	boot(schema: string): Promise<void>;
	/** The routes, as seen by the given account. */
	as(userId: string | null): Handler;
	/** The routes, behind the given auth. */
	behind(auth: SessionProvider): Handler;
	/** The current list. */
	list(userId?: string): Promise<Listed[]>;
}

/**
 * Applies `posts(id, title, body)` audited (additive, so it applies), inserts a row that fills `body`,
 * grants `admin` to `u-admin`, and returns the pieces.
 */
async function prepare(db: DatabaseHandle, dialect: Dialect): Promise<Scenario> {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	const migrations = join(dir, 'migrations');
	const context = (schema: string) => buildContext(db, dialect, schema, migrations);

	const first = context(writeSchema(dir, dialect, POSTS_V1));
	await materializeApprovalTables(first);
	await runConvergence(first, decliningResolver());
	await db.raw("insert into posts (id, title, body) values (1, 'hi', 'keep me')");

	const principals = buildApprovalSchema(dialect).principals as Table;
	await db.queryTransaction((tx) =>
		claimFirstAdmin(tx as ApprovalDb, principals, 'u-admin', dialect),
	);

	let current = first;
	const scenario: Scenario = {
		dir,
		migrations,
		async boot(schema) {
			await nextSecond();
			current = context(schema);
			await runConvergence(current, decliningResolver());
		},
		as: (userId) => createApprovalsRouter({ context: current, auth: authStub(userId) }),
		behind: (auth) => createApprovalsRouter({ context: current, auth }),
		async list(userId = 'u-admin') {
			const body = await toEnvelope(
				await send(scenario.as(userId), 'GET', '/api/pending-approvals'),
			);
			return body.data as Listed[];
		},
	};
	return scenario;
}

matrixTest(
	'the list is empty until a boot files something, then shows live counts',
	async ({ db, dialect }) => {
		const scenario = await prepare(db, dialect);
		try {
			expect(await scenario.list()).toEqual([]);

			await scenario.boot(writeSchema(scenario.dir, dialect, POSTS_WITHOUT_BODY));
			const [listed] = await scenario.list();
			expect(listed?.description).toEqual(['drop column posts.body']);
			expect(listed?.findings.map((finding) => [finding.code, finding.affectedRows])).toEqual([
				['column_has_data', 1],
			]);
			expect(listed?.findingsHash).toHaveLength(64);

			// The counts are live: another row, another number on the next look.
			await db.raw("insert into posts (id, title, body) values (2, 'two', 'also')");
			const [again] = await scenario.list();
			expect(again?.findings[0]?.affectedRows).toBe(2);
			expect(again?.findingsHash === listed?.findingsHash).toBe(false);
		} finally {
			rmSync(scenario.dir, { recursive: true, force: true });
		}
	},
);

matrixTest(
	'deciding needs a session and the admin role; looking needs only a session',
	async ({ db, dialect }) => {
		const scenario = await prepare(db, dialect);
		try {
			await scenario.boot(writeSchema(scenario.dir, dialect, POSTS_WITHOUT_BODY));
			const [listed] = await scenario.list();
			const id = listed?.id ?? '';

			expect((await send(scenario.as(null), 'GET', '/api/pending-approvals')).status).toBe(401);
			// A plain user may look, not decide.
			expect((await send(scenario.as('u-user'), 'GET', '/api/pending-approvals')).status).toBe(200);
			const approve = await send(
				scenario.as('u-user'),
				'POST',
				`/api/pending-approvals/${id}/approve`,
				{
					seen: listed?.findingsHash,
				},
			);
			expect(approve.status).toBe(403);
			expect((await toEnvelope(approve)).error?.code).toBe('FORBIDDEN');
			const reject = await send(
				scenario.as('u-user'),
				'POST',
				`/api/pending-approvals/${id}/reject`,
				{
					reason: 'no',
				},
			);
			expect(reject.status).toBe(403);

			expect(await columnExists(db, 'posts', 'body')).toBe(true);
			expect((await readTrail(db, dialect)).map(([type]) => type)).toEqual(['requested']);
		} finally {
			rmSync(scenario.dir, { recursive: true, force: true });
		}
	},
);

matrixTest(
	'approving applies the change and records who agreed to what',
	async ({ db, dialect }) => {
		const scenario = await prepare(db, dialect);
		try {
			await scenario.boot(writeSchema(scenario.dir, dialect, POSTS_WITHOUT_BODY));
			const [listed] = await scenario.list();

			const response = await send(
				scenario.as('u-admin'),
				'POST',
				`/api/pending-approvals/${listed?.id}/approve`,
				{
					seen: listed?.findingsHash,
				},
			);
			expect(response.status).toBe(200);
			const body = await toEnvelope(response);
			expect((body.data as { applied: boolean }).applied).toBe(true);

			expect(await columnExists(db, 'posts', 'body')).toBe(false);
			expect(await db.raw('select title from posts')).toHaveLength(1);
			expect(await readTrail(db, dialect)).toEqual([
				['requested', null],
				['approved', 'u-admin'],
				['applied', 'u-admin'],
			]);
			const approved = await readLatestPayload(db, dialect, 'approved');
			expect(approved['findingsHash']).toBe(listed?.findingsHash);
			expect(await scenario.list()).toEqual([]);

			// The next boot finds nothing to do and nothing to reconcile.
			await scenario.boot(writeSchema(scenario.dir, dialect, POSTS_WITHOUT_BODY));
			expect((await readTrail(db, dialect)).map(([type]) => type)).toEqual([
				'requested',
				'approved',
				'applied',
			]);
		} finally {
			rmSync(scenario.dir, { recursive: true, force: true });
		}
	},
);

// Somebody who approved "this drops 1 row" did not approve "this drops 2".
matrixTest(
	'approving with counts that moved is refused, and nothing changes',
	async ({ db, dialect }) => {
		const scenario = await prepare(db, dialect);
		try {
			await scenario.boot(writeSchema(scenario.dir, dialect, POSTS_WITHOUT_BODY));
			const [listed] = await scenario.list();
			await db.raw("insert into posts (id, title, body) values (2, 'two', 'also')");

			const response = await send(
				scenario.as('u-admin'),
				'POST',
				`/api/pending-approvals/${listed?.id}/approve`,
				{
					seen: listed?.findingsHash,
				},
			);
			expect(response.status).toBe(409);
			const envelope = await toEnvelope(response);
			expect(envelope.error?.code).toBe('CONFLICT');
			expect(envelope.error?.message).toContain('posts.body: 2 rows');

			expect(await columnExists(db, 'posts', 'body')).toBe(true);
			expect((await readTrail(db, dialect)).map(([type]) => type)).toEqual(['requested']);

			// Looking again and agreeing to the new number goes through.
			const [fresh] = await scenario.list();
			const retry = await send(
				scenario.as('u-admin'),
				'POST',
				`/api/pending-approvals/${fresh?.id}/approve`,
				{
					seen: fresh?.findingsHash,
				},
			);
			expect(retry.status).toBe(200);
			expect(await columnExists(db, 'posts', 'body')).toBe(false);
		} finally {
			rmSync(scenario.dir, { recursive: true, force: true });
		}
	},
);

matrixTest('approving after the schema moved is refused', async ({ db, dialect }) => {
	const scenario = await prepare(db, dialect);
	try {
		await scenario.boot(writeSchema(scenario.dir, dialect, POSTS_WITHOUT_BODY));
		const [listed] = await scenario.list();

		// The developer adds a table beside the drop; the request on file is not the change the schema
		// produces any more. (A new column would raise a rename question instead, refused on its own.)
		await nextSecond();
		const core = dialect === 'postgres' ? 'pg-core' : 'sqlite-core';
		const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
		const movedSchema = join(scenario.dir, 'schema-moved.ts');
		writeFileSync(
			movedSchema,
			`import { ${table}, integer, text } from 'drizzle-orm/${core}';\n` +
				`export const posts = ${table}('posts', { ${POSTS_WITHOUT_BODY} });\n` +
				`export const tags = ${table}('tags', { id: integer('id').primaryKey(), name: text('name') });\n`,
		);
		const moved = buildContext(db, dialect, movedSchema, scenario.migrations);
		const routes = createApprovalsRouter({ context: moved, auth: authStub('u-admin') });
		const response = await send(routes, 'POST', `/api/pending-approvals/${listed?.id}/approve`, {
			seen: listed?.findingsHash,
		});
		expect(response.status).toBe(409);
		expect((await toEnvelope(response)).error?.message).toContain(
			'now produces a different change',
		);

		expect(await columnExists(db, 'posts', 'body')).toBe(true);
		expect(await columnExists(db, 'tags', 'id')).toBe(false);
		expect((await readTrail(db, dialect)).map(([type]) => type)).toEqual(['requested']);
	} finally {
		rmSync(scenario.dir, { recursive: true, force: true });
	}
});

matrixTest('approving a populated table drop applies it once', async ({ db, dialect }) => {
	const scenario = await prepare(db, dialect);
	try {
		await scenario.boot(writeSchema(scenario.dir, dialect, POSTS_V1, 'drafts'));
		const [listed] = await scenario.list();
		expect(listed?.findings.map((finding) => [finding.change.kind, finding.affectedRows])).toEqual([
			['drop_table', 1],
		]);

		const response = await send(
			scenario.as('u-admin'),
			'POST',
			`/api/pending-approvals/${listed?.id}/approve`,
			{
				seen: listed?.findingsHash,
			},
		);
		expect(response.status).toBe(200);
		expect(await columnExists(db, 'posts', 'id')).toBe(false);
		expect((await readTrail(db, dialect)).map(([type]) => type)).toEqual([
			'requested',
			'approved',
			'applied',
		]);
	} finally {
		rmSync(scenario.dir, { recursive: true, force: true });
	}
});

matrixTest(
	'approving an unclassified change agrees to exactly that operation',
	async ({ db, dialect }) => {
		const scenario = await prepare(db, dialect);
		const retyped =
			dialect === 'postgres'
				? `id: integer('id').primaryKey(), title: text('title'), body: numeric('body', { precision: 10, scale: 2 })`
				: `id: integer('id').primaryKey(), title: text('title'), body: integer('body')`;
		try {
			await db.raw("update posts set body = '12.5'");
			await scenario.boot(writeSchema(scenario.dir, dialect, retyped));
			const [listed] = await scenario.list();
			expect(listed?.findings).toEqual([]);
			expect(listed?.unclassified).toHaveLength(1);

			const response = await send(
				scenario.as('u-admin'),
				'POST',
				`/api/pending-approvals/${listed?.id}/approve`,
				{
					seen: listed?.findingsHash,
				},
			);
			expect(response.status).toBe(200);
			expect((await readTrail(db, dialect)).map(([type]) => type)).toEqual([
				'requested',
				'approved',
				'applied',
			]);
		} finally {
			rmSync(scenario.dir, { recursive: true, force: true });
		}
	},
);

// A rename question an unattended boot answered `create` is recorded, said out loud, and replayed —
// never quietly answered differently at approval.
matrixTest(
	'a rename answered unattended is recorded and replayed, and refused if the record is gone',
	async ({ db, dialect }) => {
		const scenario = await prepare(db, dialect);
		try {
			await scenario.boot(
				writeSchema(
					scenario.dir,
					dialect,
					"id: integer('id').primaryKey(), title: text('title'), content: text('content')",
				),
			);
			const [listed] = await scenario.list();
			expect(listed?.decisions).toHaveLength(1);
			expect(listed?.description.some((line) => line.includes('created rather than renamed'))).toBe(
				true,
			);
			expect(listed?.findings.map((finding) => finding.change.column)).toEqual(['body']);

			// Strip the record: the approval must not answer the question on its own.
			const table = trailTable(dialect);
			const payload = await readLatestPayload(db, dialect, 'requested');
			const stripped = JSON.stringify({ ...payload, decisions: [] }).replaceAll("'", "''");
			await db.raw(`update ${table} set payload = '${stripped}' where type = 'requested'`);
			const refused = await send(
				scenario.as('u-admin'),
				'POST',
				`/api/pending-approvals/${listed?.id}/approve`,
				{
					seen: listed?.findingsHash,
				},
			);
			expect(refused.status).toBe(409);
			expect((await toEnvelope(refused)).error?.message).toContain(
				'was not answered when the request was filed',
			);
			expect(await columnExists(db, 'posts', 'body')).toBe(true);

			// With the record back, the replayed `create` regenerates the same change and applies.
			const restored = JSON.stringify(payload).replaceAll("'", "''");
			await db.raw(`update ${table} set payload = '${restored}' where type = 'requested'`);
			const approved = await send(
				scenario.as('u-admin'),
				'POST',
				`/api/pending-approvals/${listed?.id}/approve`,
				{
					seen: listed?.findingsHash,
				},
			);
			expect(approved.status).toBe(200);
			expect(await columnExists(db, 'posts', 'content')).toBe(true);
			expect(await columnExists(db, 'posts', 'body')).toBe(false);
		} finally {
			rmSync(scenario.dir, { recursive: true, force: true });
		}
	},
);

matrixTest(
	'rejecting needs a reason, records it, and the next boot does not file the change again',
	async ({ db, dialect }) => {
		const scenario = await prepare(db, dialect);
		try {
			await scenario.boot(writeSchema(scenario.dir, dialect, POSTS_WITHOUT_BODY));
			const [listed] = await scenario.list();
			const id = listed?.id ?? '';

			const empty = await send(
				scenario.as('u-admin'),
				'POST',
				`/api/pending-approvals/${id}/reject`,
				{ reason: '  ' },
			);
			expect(empty.status).toBe(422);

			const rejected = await send(
				scenario.as('u-admin'),
				'POST',
				`/api/pending-approvals/${id}/reject`,
				{
					reason: 'we still read body',
				},
			);
			expect(rejected.status).toBe(200);
			expect(await readTrail(db, dialect)).toEqual([
				['requested', null],
				['rejected', 'u-admin'],
			]);
			expect((await readLatestPayload(db, dialect, 'rejected'))['reason']).toBe(
				'we still read body',
			);
			expect(await columnExists(db, 'posts', 'body')).toBe(true);
			expect(await scenario.list()).toEqual([]);

			// The schema still asks for the drop; a person already said no, so boot does not ask again.
			await scenario.boot(writeSchema(scenario.dir, dialect, POSTS_WITHOUT_BODY));
			expect((await readTrail(db, dialect)).map(([type]) => type)).toEqual([
				'requested',
				'rejected',
			]);
			expect(await columnExists(db, 'posts', 'body')).toBe(true);
			// A closed request cannot be decided again.
			expect(
				(
					await send(scenario.as('u-admin'), 'POST', `/api/pending-approvals/${id}/reject`, {
						reason: 'x',
					})
				).status,
			).toBe(404);
		} finally {
			rmSync(scenario.dir, { recursive: true, force: true });
		}
	},
);

matrixTest(
	'two approvals of one request at once: one applies, one finds it gone',
	async ({ db, dialect }) => {
		const scenario = await prepare(db, dialect);
		try {
			await scenario.boot(writeSchema(scenario.dir, dialect, POSTS_WITHOUT_BODY));
			const [listed] = await scenario.list();
			const approve = () =>
				send(scenario.as('u-admin'), 'POST', `/api/pending-approvals/${listed?.id}/approve`, {
					seen: listed?.findingsHash,
				});

			const statuses = (await Promise.all([approve(), approve()]))
				.map((response) => response.status)
				.toSorted((a, b) => a - b);
			expect(statuses[0]).toBe(200);
			expect([404, 409]).toContain(statuses[1]);
			expect(await columnExists(db, 'posts', 'body')).toBe(false);
			expect((await readTrail(db, dialect)).filter(([type]) => type === 'applied')).toHaveLength(1);
		} finally {
			rmSync(scenario.dir, { recursive: true, force: true });
		}
	},
);

// The reservation is what stops a user table called `pending-approvals` from registering the route.
matrixTest(
	'a user table named pending-approvals cannot shadow the routes',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		try {
			const core = dialect === 'postgres' ? 'pg-core' : 'sqlite-core';
			const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
			const schema = join(dir, 'pa.mjs');
			writeFileSync(
				schema,
				`import { ${table}, integer, text } from 'drizzle-orm/${core}';\n` +
					`export const pa = ${table}('pending-approvals', { id: integer('id').primaryKey(), title: text('title').notNull() });\n`,
			);
			await db.raw(
				'create table "pending-approvals" (id integer primary key, title text not null)',
			);
			const context = buildContext(db, dialect, schema, join(dir, 'migrations'));
			await materializeApprovalTables(context);
			const auth = authStub('u1');
			const entities = await loadEntities(context.config);
			const app = new Elysia()
				.use(createContentRouter({ context, auth, entities }))
				.use(createApprovalsRouter({ context, auth }));

			// The list answers, not a content collection; content's other verbs are not registered.
			const list = await send(app, 'GET', '/api/pending-approvals');
			expect(list.status).toBe(200);
			expect((await toEnvelope(list)).data).toEqual([]);
			expect((await send(app, 'POST', '/api/pending-approvals', { title: 'hi' })).status).toBe(404);
			expect((await db.raw('select id from "pending-approvals"')).length).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

// The verify pass is a dry run: an approval applies what was approved and nothing else, not even an
// additive change the schema now carries instead of the drop.
matrixTest('verifying an approval never applies anything', async ({ db, dialect }) => {
	const scenario = await prepare(db, dialect);
	try {
		await scenario.boot(writeSchema(scenario.dir, dialect, POSTS_WITHOUT_BODY));
		const [listed] = await scenario.list();

		// The developer keeps `body` after all and adds `note`: additive only.
		await nextSecond();
		const moved = buildContext(
			db,
			dialect,
			writeSchema(scenario.dir, dialect, `${POSTS_V1}, note: text('note')`),
			scenario.migrations,
		);
		const routes = createApprovalsRouter({ context: moved, auth: authStub('u-admin') });
		const response = await send(routes, 'POST', `/api/pending-approvals/${listed?.id}/approve`, {
			seen: listed?.findingsHash,
		});
		expect(response.status).toBe(409);
		// Boot would apply `note`; an approve attempt must not.
		expect(await columnExists(db, 'posts', 'note')).toBe(false);
		expect(await columnExists(db, 'posts', 'body')).toBe(true);
		expect((await readTrail(db, dialect)).map(([type]) => type)).toEqual(['requested']);
	} finally {
		rmSync(scenario.dir, { recursive: true, force: true });
	}
});

// Deciding reads the session table, not the cookie cache: a session revoked by sign-out must not be
// able to approve a schema change.
matrixTest('deciding reads the session fresh', async ({ db, dialect }) => {
	const scenario = await prepare(db, dialect);
	try {
		await scenario.boot(writeSchema(scenario.dir, dialect, POSTS_WITHOUT_BODY));
		const [listed] = await scenario.list();
		const queries: unknown[] = [];
		const recording: SessionProvider = {
			api: {
				getSession: async ({ query }) => {
					queries.push(query);
					return { user: { id: 'u-admin' }, session: { id: 's' } };
				},
			},
		};
		const routes = scenario.behind(recording);

		// Looking goes through the macro (no fresh read asked for); deciding asks for the table.
		await send(routes, 'GET', '/api/pending-approvals');
		expect(queries).toEqual([undefined]);
		const rejected = await send(routes, 'POST', `/api/pending-approvals/${listed?.id}/reject`, {
			reason: 'not now',
		});
		expect(rejected.status).toBe(200);
		expect(queries[1]).toEqual({ disableCookieCache: true });
	} finally {
		rmSync(scenario.dir, { recursive: true, force: true });
	}
});
