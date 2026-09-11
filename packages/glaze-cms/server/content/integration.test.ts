import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveConfig } from '#config';
import { expect, matrixTest } from '#harness';
import { createLogger } from '#logger';
import { resolveRuntime } from '#runtime';

import { createGlazeApp } from '../app/index.ts';
import { materializeApprovalTables } from '../approvals/index.ts';
import { materializeAuthTables } from '../auth/index.ts';
import { resolveOptions } from '../options/index.ts';
import { loadEntities } from './loader.ts';

import type { DatabaseHandle, Dialect } from '#dialect';
import type { GlazeApp, GlazeContext } from '../app/index.ts';

// Integration tier: the FULL app over a real database and the real Better Auth engine — a genuine
// sign-up issues the session, and the content gate authenticates it through `getSession` (no stub, the
// one thing `router.test.ts` cannot cover). Only the TCP `listen()` is skipped (`app.handle`).

// A stable secret so Better Auth signs cookies deterministically (mirrors the auth plugin test).
process.env['GLAZE_AUTH_SECRET'] ??= 'glaze-integration-test-secret-0123456789abcdef';

/** Temp schema fixtures under `node_modules` (so `drizzle-orm/*` resolves), emitted `.mjs` — see the loader test. */
const TEMP_FIXTURE_PREFIX = join(
	import.meta.dirname,
	'..',
	'..',
	'node_modules',
	'glaze-content-integration-fixture-',
);

const CREDENTIALS = { email: 'ada@example.com', password: 'correct-horse-battery', name: 'Ada' };

/**
 * Writes a `posts` schema module (id PK + title) for the dialect and returns its path.
 *
 * @param dir - The directory to write into.
 * @param dialect - The dialect whose table helper/import to emit.
 * @returns The written file path.
 */
function writePostsSchema(dir: string, dialect: Dialect): string {
	const path = join(dir, 'posts.mjs');
	const core = dialect === 'postgres' ? 'pg-core' : 'sqlite-core';
	const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
	writeFileSync(
		path,
		`import { ${table}, integer, text } from 'drizzle-orm/${core}';\n` +
			`export const posts = ${table}('posts', { id: integer('id').primaryKey(), title: text('title') });\n`,
	);
	return path;
}

/**
 * Boots the full app over the live database: materializes auth tables, provisions the `posts` table,
 * loads its entity, and composes the app with content routes gated by the real auth macro.
 *
 * @param db - The provisioned database handle.
 * @param dialect - The active dialect.
 * @param schema - The `posts` schema module path.
 * @returns The composed app.
 */
async function bootContentApp(
	db: DatabaseHandle,
	dialect: Dialect,
	schema: string,
): Promise<GlazeApp> {
	const context: GlazeContext = {
		db,
		config: resolveConfig({ dialect, connection: 'unused', schema }),
		options: resolveOptions({}),
		logger: createLogger({ level: 'silent' }),
		runtime: resolveRuntime(),
	};
	await materializeAuthTables(context);
	await materializeApprovalTables(context);
	await db.raw('create table posts (id integer primary key, title text)');
	const entities = await loadEntities(context.config);
	return createGlazeApp(context, entities);
}

/** Extracts the `better-auth.session_token=…` cookie pair from a response, for echoing back. */
function sessionCookie(response: Response): string {
	const tokenCookie = response.headers
		.getSetCookie()
		.find((cookie) => cookie.startsWith('better-auth.session_token='));
	if (!tokenCookie) throw new Error('no session cookie set');
	return tokenCookie.split(';')[0] ?? '';
}

/**
 * Sends an in-memory JSON request with optional auth/extra headers.
 *
 * @param app - The composed app.
 * @param method - The HTTP method.
 * @param path - The request path.
 * @param options - Optional JSON `body` and extra `headers` (e.g. cookie/authorization).
 * @returns The Response.
 */
function send(
	app: GlazeApp,
	method: string,
	path: string,
	options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
	const { body, headers = {} } = options;
	const init: RequestInit = { method, headers };
	if (body !== undefined) {
		init.headers = { ...headers, 'content-type': 'application/json' };
		init.body = JSON.stringify(body);
	}
	return app.handle(new Request(`http://localhost${path}`, init));
}

matrixTest('a real sign-up authenticates content CRUD end to end', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const app = await bootContentApp(db, dialect, writePostsSchema(dir, dialect));

		// An unauthenticated request is gated before any DB access.
		expect((await send(app, 'GET', '/api/posts')).status).toBe(401);

		// A genuine sign-up issues the session that authorizes the content routes.
		const signUp = await send(app, 'POST', '/api/auth/sign-up/email', { body: CREDENTIALS });
		expect(signUp.status).toBe(200);
		const cookie = sessionCookie(signUp);

		const created = await send(app, 'POST', '/api/posts', {
			headers: { cookie },
			body: { id: 1, title: 'hello' },
		});
		expect(created.status).toBe(201);

		const list = await send(app, 'GET', '/api/posts', { headers: { cookie } });
		expect(list.status).toBe(200);
		expect(((await list.json()) as { data: unknown[] }).data).toHaveLength(1);

		// The same token authenticates the external-API path as a Bearer credential.
		const token = cookie.split('=')[1] ?? '';
		const byBearer = await send(app, 'GET', '/api/posts/1', {
			headers: { authorization: `Bearer ${token}` },
		});
		expect(byBearer.status).toBe(200);
		expect(((await byBearer.json()) as { data: Record<string, unknown> }).data['title']).toBe(
			'hello',
		);

		// The row really landed in the database.
		const rows = await db.raw('select title from posts where id = 1');
		expect(String(rows[0]?.['title'])).toBe('hello');

		// Signing up granted nothing: the first-admin claim is still open, and this real session is the
		// one that closes it. Asserted on the same sign-up so the rate-limit budget stays untouched.
		const before = (await (await send(app, 'GET', '/api/setup')).json()) as {
			data: { firstAdminNeeded: boolean };
		};
		expect(before.data.firstAdminNeeded).toBe(true);
		expect(
			(await send(app, 'POST', '/api/setup/first-admin', { headers: { cookie } })).status,
		).toBe(201);
		expect(
			(await send(app, 'POST', '/api/setup/first-admin', { headers: { cookie } })).status,
		).toBe(403);
		const users = await db.raw(
			`select id from ${dialect === 'postgres' ? 'glaze_auth.users' : 'zz__glaze_auth_users'}`,
		);
		const principals = await db.raw(
			`select user_id, role from ${dialect === 'postgres' ? 'glaze.principals' : 'zz__glaze_principals'}`,
		);
		// The grant went to the account Better Auth actually created, and to nobody else.
		expect(principals.map((row) => [row['user_id'], row['role']])).toEqual([
			[users[0]?.['id'], 'admin'],
		]);

		// A revoked session cannot claim. Both cookies are kept, as a client that ignored sign-out would
		// keep them: the signed session-data cookie still says "valid" for minutes, so a claim that
		// trusted it would answer 403 (sealed) here rather than 401 (nobody).
		const everyCookie = signUp.headers
			.getSetCookie()
			.map((pair) => pair.split(';')[0] ?? '')
			.join('; ');
		expect(everyCookie).toContain('better-auth.session_data=');
		// A browser sends `origin` on a cookie-authenticated POST, and Better Auth's CSRF check wants it
		// (skipped under `NODE_ENV=test`, which `bun test` sets and `node --test` does not).
		const signOut = await send(app, 'POST', '/api/auth/sign-out', {
			headers: { cookie: everyCookie, origin: 'http://localhost:4000' },
		});
		expect(signOut.status).toBe(200);
		expect(
			(await send(app, 'POST', '/api/setup/first-admin', { headers: { cookie: everyCookie } }))
				.status,
		).toBe(401);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
