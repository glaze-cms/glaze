import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Elysia } from 'elysia';

import { resolveConfig } from '#config';
import { expect, matrixTest } from '#harness';
import { createLogger } from '#logger';
import { resolveRuntime } from '#runtime';

import { materializeApprovalTables } from '../approvals/index.ts';
import { createContentRouter, loadEntities } from '../content/index.ts';
import { resolveOptions } from '../options/index.ts';
import { createSetupRouter } from './router.ts';
import { SETUP_TOKEN_HEADER } from './token.ts';

import type { DatabaseHandle, Dialect } from '#dialect';
import type { GlazeContext } from '../app/context.ts';
import type { SessionProvider } from '../auth/index.ts';

/** Temp schema fixtures under `node_modules` so `drizzle-orm/*` resolves; see the loader test. */
const TEMP_FIXTURE_PREFIX = join(
	import.meta.dirname,
	'..',
	'..',
	'node_modules',
	'glaze-setup-router-fixture-',
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

// These tests must see the token state they set themselves, not whatever the shell had.
delete process.env['GLAZE_SETUP_TOKEN'];

/** What the stub was asked for, so a test can check the claim reads the session table. */
type SessionQuery = { disableCookieCache?: boolean } | undefined;

/**
 * A stub Better Auth instance resolving the given account, or nobody, so the gate is exercised
 * without real cookies. The claim reads only `user.id`. The stub records the `query` it was called
 * with, because whether the claim bypasses the cookie cache is part of what is under test.
 *
 * @param userId - The account to resolve, or `null` for an unauthenticated request.
 * @returns A {@link SessionProvider} stub plus the queries it received.
 */
function authStub(userId: string | null): SessionProvider & { readonly queries: SessionQuery[] } {
	const session = userId ? { user: { id: userId }, session: { id: `s-${userId}` } } : null;
	const queries: SessionQuery[] = [];
	return {
		queries,
		api: {
			getSession: async ({ query }) => {
				queries.push(query);
				return session;
			},
		},
	};
}

/** Builds a Glaze context over the harness database, materializing the approvals tables. */
async function buildContext(
	db: DatabaseHandle,
	dialect: Dialect,
	schema?: string,
): Promise<GlazeContext> {
	const context: GlazeContext = {
		db,
		config: resolveConfig({ dialect, connection: 'unused', ...(schema ? { schema } : {}) }),
		options: resolveOptions({}),
		logger: createLogger({ level: 'silent' }),
		runtime: resolveRuntime(),
	};
	await materializeApprovalTables(context);
	return context;
}

/** Composes a setup router for the given account. */
async function buildRouter(db: DatabaseHandle, dialect: Dialect, userId: string | null) {
	const context = await buildContext(db, dialect);
	return createSetupRouter({ context, auth: authStub(userId) });
}

/** Sends an in-memory request. */
function send(
	app: Handler,
	method: string,
	path: string,
	headers: Record<string, string> = {},
): Promise<Response> {
	return app.handle(new Request(`http://localhost${path}`, { method, headers }));
}

/** Parses a response as the API envelope, surfacing status + raw text when it is not JSON. */
async function toEnvelope(response: Response): Promise<Envelope> {
	const text = await response.text();
	try {
		return JSON.parse(text) as Envelope;
	} catch {
		throw new Error(`expected a JSON envelope, got ${response.status}: ${text.slice(0, 120)}`);
	}
}

/** Every principals row, as `{ user_id, role }`, to assert exactly what was written. */
async function readPrincipals(
	db: DatabaseHandle,
	dialect: Dialect,
): Promise<Array<{ user_id: string; role: string }>> {
	const table = dialect === 'postgres' ? 'glaze.principals' : 'zz__glaze_principals';
	const rows = await db.raw(`select user_id, role from ${table} order by user_id`);
	return rows.map((row) => ({ user_id: String(row['user_id']), role: String(row['role']) }));
}

/** Whether `GET /api/setup` reports that a first admin is still needed. */
async function firstAdminNeeded(app: Handler): Promise<boolean> {
	const body = await toEnvelope(await send(app, 'GET', '/api/setup'));
	return (body.data as { firstAdminNeeded: boolean }).firstAdminNeeded;
}

/**
 * Runs `fn` with `GLAZE_SETUP_TOKEN` set to `value` (or cleared), restoring the prior value after.
 *
 * @param value - The token to set, or `undefined` to clear it.
 * @param fn - The body to run.
 * @returns Whatever `fn` returns.
 */
async function withSetupToken<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
	const saved = process.env['GLAZE_SETUP_TOKEN'];
	if (value === undefined) delete process.env['GLAZE_SETUP_TOKEN'];
	else process.env['GLAZE_SETUP_TOKEN'] = value;
	try {
		return await fn();
	} finally {
		if (saved === undefined) delete process.env['GLAZE_SETUP_TOKEN'];
		else process.env['GLAZE_SETUP_TOKEN'] = saved;
	}
}

matrixTest('the first claim grants admin to the signed-in account', async ({ db, dialect }) => {
	const context = await buildContext(db, dialect);
	const auth = authStub('u1');
	const app = createSetupRouter({ context, auth });
	expect(await firstAdminNeeded(app)).toBe(true);

	const claimed = await send(app, 'POST', '/api/setup/first-admin');
	expect(claimed.status).toBe(201);
	expect(await toEnvelope(claimed)).toEqual({
		success: true,
		data: { role: 'admin' },
		error: null,
	});

	expect(await readPrincipals(db, dialect)).toEqual([{ user_id: 'u1', role: 'admin' }]);
	expect(await firstAdminNeeded(app)).toBe(false);
	// The claim read the session table, not the signed cookie: a session revoked by sign-out must not
	// be able to make an admin, and the cookie cache would say yes to one for minutes.
	expect(auth.queries).toEqual([{ disableCookieCache: true }]);
});

// The seal is "an admin exists": a later account is refused and the admin's own retry is refused too.
// Neither writes anything — the only row is still the first claimant's.
matrixTest('once an admin exists, every claim is refused', async ({ db, dialect }) => {
	const context = await buildContext(db, dialect);
	const first = createSetupRouter({ context, auth: authStub('u1') });
	const second = createSetupRouter({ context, auth: authStub('u2') });
	expect((await send(first, 'POST', '/api/setup/first-admin')).status).toBe(201);

	const refused = await send(second, 'POST', '/api/setup/first-admin');
	expect(refused.status).toBe(403);
	expect((await toEnvelope(refused)).error?.code).toBe('FORBIDDEN');
	expect((await send(first, 'POST', '/api/setup/first-admin')).status).toBe(403);

	expect(await readPrincipals(db, dialect)).toEqual([{ user_id: 'u1', role: 'admin' }]);
});

matrixTest(
	'an unauthenticated claim is refused before anything is read',
	async ({ db, dialect }) => {
		const app = await buildRouter(db, dialect, null);

		const refused = await send(app, 'POST', '/api/setup/first-admin');
		expect(refused.status).toBe(401);
		expect((await toEnvelope(refused)).error?.code).toBe('UNAUTHORIZED');

		expect(await readPrincipals(db, dialect)).toEqual([]);
		// The status read needs no session.
		expect(await firstAdminNeeded(app)).toBe(true);
	},
);

// A session whose user carries no id cannot be granted anything: there would be nobody to grant it to.
// That is the server's fault, not the caller's, so it is a 500 and not a 401.
matrixTest('a session without a user id cannot claim', async ({ db, dialect }) => {
	const context = await buildContext(db, dialect);
	const auth: SessionProvider = {
		api: { getSession: async () => ({ user: { name: 'Ada' }, session: { id: 's1' } }) },
	};
	const app = createSetupRouter({ context, auth });

	const refused = await send(app, 'POST', '/api/setup/first-admin');
	expect(refused.status).toBe(500);
	expect((await toEnvelope(refused)).error?.code).toBe('INTERNAL');
	expect(await readPrincipals(db, dialect)).toEqual([]);
});

// Every answer is the envelope, including the ones Elysia would otherwise give itself.
matrixTest('errors stay in the envelope', async ({ db, dialect }) => {
	const app = await buildRouter(db, dialect, 'u1');

	const missing = await send(app, 'GET', '/api/setup/first-admin');
	expect(missing.status).toBe(404);
	expect((await toEnvelope(missing)).error?.code).toBe('NOT_FOUND');

	// A broken install: the table is gone. The client gets a clean 500, not the driver's message.
	await db.raw(
		`drop table ${dialect === 'postgres' ? 'glaze.principals' : 'zz__glaze_principals'}`,
	);
	const broken = await send(app, 'GET', '/api/setup');
	expect(broken.status).toBe(500);
	expect(await toEnvelope(broken)).toEqual({
		success: false,
		data: null,
		error: { code: 'INTERNAL', message: 'Internal server error' },
	});
});

matrixTest('with a setup token configured, the claim needs it', async ({ db, dialect }) => {
	const app = await buildRouter(db, dialect, 'u1');

	await withSetupToken('correct-horse-battery-staple', async () => {
		const missing = await send(app, 'POST', '/api/setup/first-admin');
		expect(missing.status).toBe(403);
		expect((await toEnvelope(missing)).error?.code).toBe('FORBIDDEN');

		// Same length, one character off: only the contents can tell them apart.
		const wrong = await send(app, 'POST', '/api/setup/first-admin', {
			[SETUP_TOKEN_HEADER]: 'correct-horse-battery-stapLe',
		});
		expect(wrong.status).toBe(403);
		expect(await readPrincipals(db, dialect)).toEqual([]);

		const right = await send(app, 'POST', '/api/setup/first-admin', {
			[SETUP_TOKEN_HEADER]: 'correct-horse-battery-staple',
		});
		expect(right.status).toBe(201);
	});

	expect(await readPrincipals(db, dialect)).toEqual([{ user_id: 'u1', role: 'admin' }]);
});

// Once sealed, the token can no longer be probed through this route: the seal answers first, with
// the same 403 for a right token and a wrong one.
matrixTest('a sealed claim does not reveal whether a token was right', async ({ db, dialect }) => {
	const context = await buildContext(db, dialect);
	const first = createSetupRouter({ context, auth: authStub('u1') });
	const second = createSetupRouter({ context, auth: authStub('u2') });

	await withSetupToken('correct-horse-battery-staple', async () => {
		const header = { [SETUP_TOKEN_HEADER]: 'correct-horse-battery-staple' };
		expect((await send(first, 'POST', '/api/setup/first-admin', header)).status).toBe(201);

		const right = await toEnvelope(await send(second, 'POST', '/api/setup/first-admin', header));
		const wrong = await toEnvelope(
			await send(second, 'POST', '/api/setup/first-admin', { [SETUP_TOKEN_HEADER]: 'nope' }),
		);
		expect(right.error?.message).toBe('An admin already exists');
		expect(wrong.error?.message).toBe('An admin already exists');
	});
});

// A blank token is no token — the same rule `server/env` applies to every variable, so a
// `GLAZE_SETUP_TOKEN=` line copied from `.env.example` does not lock everybody out.
matrixTest('a blank setup token is treated as unset', async ({ db, dialect }) => {
	const app = await buildRouter(db, dialect, 'u1');
	await withSetupToken('   ', async () => {
		expect((await send(app, 'POST', '/api/setup/first-admin')).status).toBe(201);
	});
});

// The reservation is what stops a user table called `setup` from registering `/api/setup` and
// `/api/setup/:id` and putting content CRUD where the claim lives. Proved against both routers
// composed together, in the order the app mounts them.
matrixTest('a user table named setup cannot shadow these routes', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const core = dialect === 'postgres' ? 'pg-core' : 'sqlite-core';
		const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
		const schema = join(dir, 'setup.mjs');
		writeFileSync(
			schema,
			`import { ${table}, integer, text } from 'drizzle-orm/${core}';\n` +
				`export const setup = ${table}('setup', { id: integer('id').primaryKey(), title: text('title').notNull() });\n`,
		);
		await db.raw('create table setup (id integer primary key, title text not null)');

		const context = await buildContext(db, dialect, schema);
		const auth = authStub('u1');
		const entities = await loadEntities(context.config);
		const app = new Elysia()
			.use(createContentRouter({ context, auth, entities }))
			.use(createSetupRouter({ context, auth }));

		// The status read answers, not a content list.
		expect(await firstAdminNeeded(app)).toBe(true);
		// Mount order alone would win the GET, so that is not what this proves. The reservation is what
		// stops content registering its OTHER verbs on the same prefix: without it, this POST creates a
		// row in a table called `setup` and answers 201.
		const created = await app.handle(
			new Request('http://localhost/api/setup', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title: 'hi' }),
			}),
		);
		expect(created.status).toBe(404);
		expect((await send(app, 'DELETE', '/api/setup/1')).status).toBe(404);
		// And the child route is still the claim, not a content row by id.
		expect((await send(app, 'POST', '/api/setup/first-admin')).status).toBe(201);
		expect((await db.raw('select id from setup')).length).toBe(0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
