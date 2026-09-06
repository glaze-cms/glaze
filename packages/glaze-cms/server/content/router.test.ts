import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Elysia } from 'elysia';

import { resolveConfig } from '#config';
import { expect, matrixTest } from '#harness';
import { createLogger } from '#logger';
import { resolveRuntime } from '#runtime';

import { resolveOptions } from '../options/index.ts';
import { loadEntities } from './loader.ts';
import { createContentRouter } from './router.ts';

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
 * Writes a `posts` schema whose columns back a UNIQUE constraint (`email`) and a foreign key
 * (`author_id`). The FK lives only in the DDL (see {@link createConstraintTables}); the module keeps
 * `authorId` a plain column so the generated body schema accepts it.
 *
 * @param dir - The directory to write into.
 * @param dialect - The dialect whose table helper/import to emit.
 * @returns The written file path.
 */
function writeConstraintSchema(dir: string, dialect: Dialect): string {
	const path = join(dir, 'posts.mjs');
	const core = dialect === 'postgres' ? 'pg-core' : 'sqlite-core';
	const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
	writeFileSync(
		path,
		`import { ${table}, integer, text } from 'drizzle-orm/${core}';\n` +
			`export const posts = ${table}('posts', { id: integer('id').primaryKey(), email: text('email'), authorId: integer('author_id') });\n`,
	);
	return path;
}

/**
 * Provisions the constraint fixtures: an `authors` parent plus a `posts` table with a UNIQUE `email` and
 * a FK `author_id → authors(id)`. Enables SQLite FK enforcement for the test (off by default in the
 * seam), so a FK violation actually throws on both dialects.
 *
 * @param db - The database handle.
 * @param dialect - The active dialect.
 */
async function createConstraintTables(db: DatabaseHandle, dialect: Dialect): Promise<void> {
	if (dialect === 'sqlite') await db.raw('PRAGMA foreign_keys = ON');
	await db.raw('create table authors (id integer primary key)');
	await db.raw(
		'create table posts (id integer primary key, email text unique, author_id integer references authors(id))',
	);
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
	const entities = await loadEntities(context.config);
	return createContentRouter({ context, auth: authStub(session), entities });
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
	/** Present on list responses only. */
	meta?: { total: number; limit: number; offset: number };
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

matrixTest('does not expose an excluded entity', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir, { exclude: ['posts'] });

		// No route registered ⇒ 404 (not 401): the entity is withheld entirely, still DB-managed.
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

matrixTest('skips an entity whose name collides with a reserved route', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const context = buildContext(db, dialect, writePostsSchema(dir, dialect));
		const [posts] = await loadEntities(context.config);
		if (!posts) throw new Error('expected the posts entity');
		// Re-label the entity `auth` — it would shadow Better Auth's `/api/auth/*`, so it is skipped.
		const router = createContentRouter({
			context,
			auth: authStub(SESSION),
			entities: [{ ...posts, name: 'auth' }],
		});

		expect((await send(router, 'GET', '/api/auth')).status).toBe(404);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('skips an entity named after the approvals route', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const context = buildContext(db, dialect, writePostsSchema(dir, dialect));
		const [posts] = await loadEntities(context.config);
		if (!posts) throw new Error('expected the posts entity');
		// A table called `pending-approvals` would otherwise claim the approvals routes and their
		// `/:id` children, putting content CRUD where approve and reject live.
		const router = createContentRouter({
			context,
			auth: authStub(SESSION),
			entities: [{ ...posts, name: 'pending-approvals' }],
		});

		expect((await send(router, 'GET', '/api/pending-approvals')).status).toBe(404);
		expect((await send(router, 'GET', '/api/pending-approvals/1')).status).toBe(404);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('scopes CORS to content routes, never sibling scopes', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	const origin = 'https://partner.example';
	try {
		await createPostsTable(db);
		const schema = writePostsSchema(dir, dialect);
		const context = buildContext(db, dialect, schema, { cors: { origin, credentials: true } });
		const entities = await loadEntities(context.config);
		const content = createContentRouter({ context, auth: authStub(SESSION), entities });
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

matrixTest(
	'maps real DB constraint violations to typed 4xx envelopes, not 500s',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		try {
			await createConstraintTables(db, dialect);
			const context = buildContext(db, dialect, writeConstraintSchema(dir, dialect));
			const entities = await loadEntities(context.config);
			const router = createContentRouter({ context, auth: authStub(SESSION), entities });
			const post = (body: unknown) => send(router, 'POST', '/api/posts', body);

			// A valid create still succeeds (no false positives) and seeds the conflicting row.
			expect((await post({ id: 1, email: 'a@b.com' })).status).toBe(201);

			// Duplicate primary key → 409 CONFLICT, naming the pk column.
			const dupPk = await post({ id: 1, email: 'z@z.com' });
			expect(dupPk.status).toBe(409);
			const dupPkEnv = await toEnvelope(dupPk);
			expect(dupPkEnv.success).toBe(false);
			expect(dupPkEnv.error?.code).toBe('CONFLICT');
			expect(dupPkEnv.error?.fields?.[0]?.path).toBe('id');

			// Duplicate unique value → 409 CONFLICT, naming the unique column.
			const dupUnique = await post({ id: 2, email: 'a@b.com' });
			expect(dupUnique.status).toBe(409);
			const dupUniqueEnv = await toEnvelope(dupUnique);
			expect(dupUniqueEnv.error?.code).toBe('CONFLICT');
			expect(dupUniqueEnv.error?.fields?.[0]?.path).toBe('email');

			// Missing FK parent → 409 FOREIGN_KEY.
			const badFk = await post({ id: 3, email: 'f@k.com', authorId: 999 });
			expect(badFk.status).toBe(409);
			expect((await toEnvelope(badFk)).error?.code).toBe('FOREIGN_KEY');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

matrixTest('reports the total row count alongside a page', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir);
		await Promise.all(
			[1, 2, 3, 4, 5].map((id) => send(router, 'POST', '/api/posts', { id, title: `post ${id}` })),
		);

		const counted = await toEnvelope(
			await send(router, 'GET', '/api/posts?limit=2&offset=2&count=true'),
		);
		expect(counted.data).toHaveLength(2);
		// The total counts every matching row, not the page — a pager cannot work otherwise.
		expect(counted.meta?.total).toBe(5);
		expect(counted.meta?.limit).toBe(2);
		expect(counted.meta?.offset).toBe(2);

		// Counting doubles the cost of the hottest endpoint, so it is opt-in; `meta` is still present.
		const uncounted = await toEnvelope(await send(router, 'GET', '/api/posts?limit=2'));
		expect(uncounted.data).toHaveLength(2);
		expect(uncounted.meta?.total).toBeNull();
		expect(uncounted.meta?.limit).toBe(2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('counts only the rows a filter matches', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir);
		await send(router, 'POST', '/api/posts', { id: 1, title: 'keep' });
		await send(router, 'POST', '/api/posts', { id: 2, title: 'keep' });
		await send(router, 'POST', '/api/posts', { id: 3, title: 'drop' });

		const filtered = await toEnvelope(
			await send(router, 'GET', '/api/posts?filter[title]=keep&count=true'),
		);
		expect(filtered.data).toHaveLength(2);
		// The count must apply the same filter as the page, or the pager reports phantom rows.
		expect(filtered.meta?.total).toBe(2);

		const ranged = await toEnvelope(
			await send(router, 'GET', '/api/posts?filter[id][gt]=1&count=true'),
		);
		expect(ranged.meta?.total).toBe(2);

		const listed = await toEnvelope(
			await send(router, 'GET', '/api/posts?filter[id][in]=1,3&count=true'),
		);
		expect(listed.meta?.total).toBe(2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('sorts by a requested column and direction', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir);
		await send(router, 'POST', '/api/posts', { id: 1, title: 'b' });
		await send(router, 'POST', '/api/posts', { id: 2, title: 'a' });
		await send(router, 'POST', '/api/posts', { id: 3, title: 'c' });

		const ascending = await toEnvelope(await send(router, 'GET', '/api/posts?sort=title'));
		expect((ascending.data as { title: string }[]).map((row) => row.title)).toEqual([
			'a',
			'b',
			'c',
		]);

		const descending = await toEnvelope(
			await send(router, 'GET', '/api/posts?sort=title&order=desc'),
		);
		expect((descending.data as { title: string }[]).map((row) => row.title)).toEqual([
			'c',
			'b',
			'a',
		]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('rejects an unusable sort or filter instead of ignoring it', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir);
		await send(router, 'POST', '/api/posts', { id: 1, title: 'only' });

		// Silently ignoring these would return MORE rows than asked for — a failure that looks like success.
		const rejected = [
			'?sort=nope',
			'?order=sideways',
			'?filter[nope]=1',
			'?filter[id][bogus]=1',
			'?filter[id]=abc',
			'?limit=0.5',
			'?limit=abc',
			'?offset=-5',
		];
		const responses = await Promise.all(
			rejected.map((query) => send(router, 'GET', `/api/posts${query}`)),
		);
		const envelopes = await Promise.all(responses.map(toEnvelope));

		expect(responses.map((response) => response.status)).toEqual(rejected.map(() => 422));
		expect(envelopes.map((envelope) => envelope.error?.code)).toEqual(
			rejected.map(() => 'VALIDATION'),
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('serves the content model at the entities route', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir);

		const response = await send(router, 'GET', '/api/entities');
		expect(response.status).toBe(200);

		const schema = (await toEnvelope(response)).data as {
			entities: {
				name: string;
				displayField: string | null;
				capabilities: { byId: boolean };
				fields: { name: string; fieldType: string; fieldTypeSource: string }[];
			}[];
		};
		expect(schema.entities).toHaveLength(1);
		expect(schema.entities[0]?.name).toBe('posts');
		expect(schema.entities[0]?.capabilities.byId).toBe(true);
		expect(schema.entities[0]?.displayField).toBe('title');

		const title = schema.entities[0]?.fields.find((field) => field.name === 'title');
		expect(title?.fieldType).toBe('shortText');
		// Every presentation key is present and marked inferred, so the shape is final before overrides.
		expect(title?.fieldTypeSource).toBe('inferred');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('gates the entities route behind a session', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir, { session: null });

		const response = await send(router, 'GET', '/api/entities');
		expect(response.status).toBe(401);
		expect((await toEnvelope(response)).error?.code).toBe('UNAUTHORIZED');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('never lets a prototype property pass as a column', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir);
		await send(router, 'POST', '/api/posts', { id: 1, title: 'only' });

		// `getTableColumns` returns a plain object, so `columns['constructor']` is a truthy function that
		// sails past an `if (!column)` guard and into the query builder — a 500, and an authenticated
		// client emitting unbounded stack traces at request rate.
		const hostile = ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf'];
		const filters = await Promise.all(
			hostile.map((name) => send(router, 'GET', `/api/posts?filter[${name}]=1`)),
		);
		const sorts = await Promise.all(
			hostile.map((name) => send(router, 'GET', `/api/posts?sort=${name}`)),
		);

		expect(filters.map((response) => response.status)).toEqual(hostile.map(() => 422));
		expect(sorts.map((response) => response.status)).toEqual(hostile.map(() => 422));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('ignores query parameters that are not filters', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir);
		await send(router, 'POST', '/api/posts', { id: 1, title: 'only' });

		// A CDN, a WAF, jQuery's cache-buster and any shared link carrying utm_* all append parameters.
		// Hard-failing them would break a content API for reasons that have nothing to do with the query.
		const benign = ['?_=1699999', '?utm_source=newsletter', '?fbclid=abc', '?v=2'];
		const responses = await Promise.all(
			benign.map((query) => send(router, 'GET', `/api/posts${query}`)),
		);
		expect(responses.map((response) => response.status)).toEqual(benign.map(() => 200));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('coerces filter values identically on both dialects', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir);
		await send(router, 'POST', '/api/posts', { id: 1, title: 'only' });

		// Each of these previously returned 200-with-wrong-answer on SQLite and 500 on Postgres. A value
		// that silently becomes a different number selects a row the caller did not ask for.
		const malformed = [
			'?filter[id]=1.5',
			'?filter[id]=9007199254740993',
			'?filter[id]=0x10',
			'?filter[id]=%201',
			'?filter[id][gt]=1e3',
		];
		const responses = await Promise.all(
			malformed.map((query) => send(router, 'GET', `/api/posts${query}`)),
		);
		expect(responses.map((response) => response.status)).toEqual(malformed.map(() => 422));

		// The id route already held this line; the filter path must not be looser than it.
		expect((await send(router, 'GET', '/api/posts/0x10')).status).toBe(400);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest('searches text without exposing wildcards or collation', async ({ db, dialect }) => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		await createPostsTable(db);
		const router = await buildRouter(db, dialect, dir);
		await send(router, 'POST', '/api/posts', { id: 1, title: 'Hello World' });
		await send(router, 'POST', '/api/posts', { id: 2, title: '50% off' });
		await send(router, 'POST', '/api/posts', { id: 3, title: 'unrelated' });

		// Case must not depend on the engine: Postgres LIKE matches case, SQLite's does not.
		const lower = await toEnvelope(
			await send(router, 'GET', '/api/posts?filter[title][contains]=hello'),
		);
		expect(lower.data).toHaveLength(1);

		// A caller's `%` is a literal, not a wildcard — otherwise searching for it matches everything.
		const literal = await toEnvelope(
			await send(router, 'GET', '/api/posts?filter[title][contains]=50%25'),
		);
		expect(literal.data).toHaveLength(1);

		const anchored = await toEnvelope(
			await send(router, 'GET', '/api/posts?filter[title][startsWith]=Hello'),
		);
		expect(anchored.data).toHaveLength(1);

		// Text search against a number is a caller error, and errors at the driver on Postgres.
		expect((await send(router, 'GET', '/api/posts?filter[id][contains]=1')).status).toBe(422);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

matrixTest(
	'bounds an in-filter so one request cannot exhaust the driver',
	async ({ db, dialect }) => {
		const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
		try {
			await createPostsTable(db);
			const router = await buildRouter(db, dialect, dir);

			// Postgres caps a statement at 65535 bind parameters; an unbounded list is a cheap 500.
			const huge = Array.from({ length: 500 }, (_, index) => index).join(',');
			expect((await send(router, 'GET', `/api/posts?filter[id][in]=${huge}`)).status).toBe(422);
			// An empty list would otherwise mean "the empty string" on text and 422 on numbers.
			expect((await send(router, 'GET', '/api/posts?filter[id][in]=')).status).toBe(422);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);
