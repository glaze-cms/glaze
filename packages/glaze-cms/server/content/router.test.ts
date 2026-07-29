import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Elysia } from 'elysia';

import { resolveConfig } from '#config';
import { expect, matrixTest } from '#harness';
import { createLogger } from '#logger';
import { resolveRuntime } from '#runtime';

import { resolveOptions } from '../options/index.ts';
import { createContentRouter } from './router.ts';
import { loadCollections } from './schema.ts';

import type { DatabaseHandle, Dialect } from '#dialect';
import type { GlazeContext } from '../app/context.ts';
import type { SessionProvider } from '../auth/index.ts';
import type { CorsOptions } from '../options/index.ts';

/** Temp schema fixtures under `node_modules` so `drizzle-orm/*` resolves; see the loader test. */
const TEMP_FIXTURE_PREFIX = join(
	import.meta.dirname,
	'..',
	'..',
	'node_modules',
	'glaze-content-router-fixture-',
);

/** A resolved fake session, returned by the stub auth for authorized requests. */
const SESSION = { user: { id: 'u1' }, session: { id: 's1' } } as const;

/**
 * A stub Better Auth instance whose `getSession` returns the given session (or `null` to simulate an
 * unauthenticated request), so the gate is exercised without real cookies/tokens.
 *
 * @param session - The session to resolve, or `null` for unauthenticated.
 * @returns A {@link SessionProvider} stub.
 */
function authStub(session: { user: unknown; session: unknown } | null): SessionProvider {
	return { api: { getSession: async () => session } };
}

/**
 * Writes a `posts` schema module (id PK + title) for the dialect and returns its path. Emitted as `.mjs`
 * so both runtimes import it natively — Node won't type-strip a `.ts` under `node_modules` (see the
 * loader test).
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
			`export const posts = ${table}('posts', { id: integer('id').primaryKey(), title: text('title').notNull() });\n`,
	);
	return path;
}

/**
 * Builds a Glaze context pointing at the schema file, with an optional exclusion list and CORS config.
 *
 * @param db - The provisioned database handle.
 * @param dialect - The active dialect.
 * @param schema - The schema module path.
 * @param opts - Optional `exclude` list and `cors` config.
 * @returns The context.
 */
function buildContext(
	db: DatabaseHandle,
	dialect: Dialect,
	schema: string,
	opts: { exclude?: readonly string[]; cors?: CorsOptions } = {},
): GlazeContext {
	const { exclude = [], cors } = opts;
	return {
		db,
		config: resolveConfig({ dialect, connection: 'unused', schema }),
		options: resolveOptions({ ...(cors ? { security: { cors } } : {}), content: { exclude } }),
		logger: createLogger({ level: 'silent' }),
		runtime: resolveRuntime(),
	};
}

/**
 * Provisions the physical `posts` table (id integer PK + title text — identical DDL on both dialects).
 *
 * @param db - The database handle.
 */
async function createPostsTable(db: DatabaseHandle): Promise<void> {
	await db.raw('create table posts (id integer primary key, title text not null)');
}

/**
 * Composes a content router over a freshly written `posts` schema and provisioned table.
 *
 * @param db - The database handle.
 * @param dialect - The active dialect.
 * @param dir - The temp fixture directory.
 * @param options - `session` (defaults to a valid one) and `exclude` list.
 * @returns The composed router.
 */
async function buildRouter(
	db: DatabaseHandle,
	dialect: Dialect,
	dir: string,
	options: {
		session?: { user: unknown; session: unknown } | null;
		exclude?: readonly string[];
	} = {},
) {
	const { session = SESSION, exclude = [] } = options;
	const schema = writePostsSchema(dir, dialect);
	const context = buildContext(db, dialect, schema, { exclude });
	const collections = await loadCollections(context.config);
	return createContentRouter({ context, auth: authStub(session), collections });
}

/**
 * Sends an in-memory JSON request to the router.
 *
 * @param router - The composed router.
 * @param method - The HTTP method.
 * @param path - The request path.
 * @param body - An optional JSON body.
 * @returns The Response.
 */
function send(
	router: { handle(request: Request): Promise<Response> },
	method: string,
	path: string,
	body?: unknown,
): Promise<Response> {
	const init: RequestInit =
		body === undefined
			? { method }
			: { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
	return router.handle(new Request(`http://localhost${path}`, init));
}

/** The `{ success, data, error }` envelope every content response carries. */
interface Envelope {
	success: boolean;
	data: unknown;
	error: { code: string; message: string; fields?: { path: string; message: string }[] } | null;
}

/** Parses a response body as the API envelope, surfacing the status + raw text if it isn't JSON. */
async function toEnvelope(response: Response): Promise<Envelope> {
	const text = await response.text();
	try {
		return JSON.parse(text) as Envelope;
	} catch {
		throw new Error(`expected a JSON envelope, got ${response.status}: ${text.slice(0, 120)}`);
	}
}

matrixTest('creates a row and drops unknown fields', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir);

		const response = await send(router, 'POST', '/api/posts', {
			id: 1,
			title: 'hello',
			bogus: 'ignored',
		});
		expect(response.status).toBe(201);

		const created = (await toEnvelope(response)).data as Record<string, unknown>;
		expect(created['title']).toBe('hello');
		// An unknown field must be stripped by validation (not merely ignored by the DB) — its absence proves it.
		expect('bogus' in created).toBe(false);

		const rows = await db.raw('select title from posts where id = 1');
		expect(String(rows[0]?.['title'])).toBe('hello');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('lists, reads, updates, and deletes by id', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir);

		await send(router, 'POST', '/api/posts', { id: 1, title: 'first' });
		await send(router, 'POST', '/api/posts', { id: 2, title: 'second' });

		const list = await send(router, 'GET', '/api/posts');
		expect(list.status).toBe(200);
		expect((await toEnvelope(list)).data).toHaveLength(2);

		const read = await send(router, 'GET', '/api/posts/1');
		expect(read.status).toBe(200);
		expect(((await toEnvelope(read)).data as Record<string, unknown>)['title']).toBe('first');

		const updated = await send(router, 'PATCH', '/api/posts/1', { title: 'renamed' });
		expect(updated.status).toBe(200);
		expect(((await toEnvelope(updated)).data as Record<string, unknown>)['title']).toBe('renamed');

		const removed = await send(router, 'DELETE', '/api/posts/1');
		expect(removed.status).toBe(200);
		expect(((await toEnvelope(removed)).data as Record<string, unknown>)['deleted']).toBe(true);

		const gone = await send(router, 'GET', '/api/posts/1');
		expect(gone.status).toBe(404);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('404s an unknown id and 400s a malformed one', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir);

		expect((await send(router, 'GET', '/api/posts/999')).status).toBe(404);
		// A numeric PK requires a canonical, safe integer — everything non-canonical is a bad request,
		// not a lookup miss. `9007…993` (> 2^53) would round to a neighbour and select the wrong row.
		const malformed = ['abc', '0x10', '1e3', '1.5', '9007199254740993'];
		const statuses = await Promise.all(
			malformed.map((bad) => send(router, 'GET', `/api/posts/${bad}`).then((r) => r.status)),
		);
		expect(statuses).toEqual(malformed.map(() => 400));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('rejects an unauthenticated request with 401', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir, { session: null });

		const response = await send(router, 'GET', '/api/posts');
		expect(response.status).toBe(401);
		const env = await toEnvelope(response);
		expect(env.success).toBe(false);
		expect(env.error?.code).toBe('UNAUTHORIZED');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('does not expose an excluded collection', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir, { exclude: ['posts'] });

		// No route registered ⇒ 404 (not 401): the collection is withheld entirely, still DB-managed.
		expect((await send(router, 'GET', '/api/posts')).status).toBe(404);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest(
	'lists are ordered by primary key regardless of insertion order',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		try {
			await createPostsTable(db);
			const router = await buildRouter(db, dialect, dir);

			// Insert out of key order (sequentially — one SQLite writer); the list must still come back
			// ascending by id, proving the ordering is applied and paging is deterministic.
			for (const id of [3, 1, 2]) {
				// eslint-disable-next-line no-await-in-loop
				await send(router, 'POST', '/api/posts', { id, title: `p${id}` });
			}
			const rows = (await toEnvelope(await send(router, 'GET', '/api/posts'))).data as {
				id: number;
			}[];
			expect(rows.map((row) => row.id)).toEqual([1, 2, 3]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

matrixTest('422s a body that fails validation, enveloped', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir);

		// `title` (NOT NULL, no default) is required on both dialects — omitting it fails validation.
		const missing = await send(router, 'POST', '/api/posts', { id: 1 });
		expect(missing.status).toBe(422);
		const env = await toEnvelope(missing);
		expect(env.success).toBe(false);
		expect(env.error?.code).toBe('VALIDATION');

		// A wrong-typed field is rejected, not coerced.
		const wrongType = await send(router, 'POST', '/api/posts', { id: 2, title: 42 });
		expect(wrongType.status).toBe(422);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('a PATCH body cannot reassign the primary key', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir);
		await send(router, 'POST', '/api/posts', { id: 1, title: 'orig' });

		// `id` is omitted from the update schema, so it is stripped: row 1 is renamed, nothing moves to 9.
		const updated = await send(router, 'PATCH', '/api/posts/1', { id: 9, title: 'renamed' });
		expect(updated.status).toBe(200);
		expect(((await toEnvelope(updated)).data as Record<string, unknown>)['title']).toBe('renamed');
		expect((await send(router, 'GET', '/api/posts/9')).status).toBe(404);

		const rows = await db.raw('select id, title from posts');
		expect(rows).toHaveLength(1);
		expect(String(rows[0]?.['id'])).toBe('1');
		expect(String(rows[0]?.['title'])).toBe('renamed');

		// An empty update body has nothing to set → 422 (enveloped).
		expect((await send(router, 'PATCH', '/api/posts/1', {})).status).toBe(422);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('a malformed JSON body stays in the envelope (400)', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir);

		// Bypass `send` (which stringifies) to post a body that is NOT valid JSON.
		const response = await router.handle(
			new Request('http://localhost/api/posts', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{ not json',
			}),
		);
		expect(response.status).toBe(400);
		const env = await toEnvelope(response);
		expect(env.success).toBe(false);
		expect(env.error?.code).toBe('VALIDATION');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest(
	'skips a collection whose name collides with a reserved route',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		try {
			const context = buildContext(db, dialect, writePostsSchema(dir, dialect));
			const [posts] = await loadCollections(context.config);
			if (!posts) throw new Error('expected the posts collection');
			// Re-label the collection `auth` — it would shadow Better Auth's `/api/auth/*`, so it is skipped.
			const router = createContentRouter({
				context,
				auth: authStub(SESSION),
				collections: [{ ...posts, name: 'auth' }],
			});

			expect((await send(router, 'GET', '/api/auth')).status).toBe(404);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

matrixTest('scopes CORS to content routes, never sibling scopes', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	const origin = 'https://partner.example';
	try {
		await createPostsTable(db);
		const schema = writePostsSchema(dir, dialect);
		const context = buildContext(db, dialect, schema, { cors: { origin, credentials: true } });
		const collections = await loadCollections(context.config);
		const content = createContentRouter({ context, auth: authStub(SESSION), collections });
		const app = new Elysia().use(content).get('/', () => 'root');

		const onContent = await app.handle(
			new Request('http://localhost/api/posts', { headers: { origin } }),
		);
		expect(onContent.headers.get('access-control-allow-origin')).toBe(origin);

		// The CORS header must NOT ride on a sibling (root/auth) scope the content router never touched.
		const onRoot = await app.handle(new Request('http://localhost/', { headers: { origin } }));
		expect(onRoot.headers.get('access-control-allow-origin')).toBeNull();

		// Preflight on a content route is answered (ungated) with the allow headers.
		const preflight = await app.handle(
			new Request('http://localhost/api/posts', { method: 'OPTIONS', headers: { origin } }),
		);
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
