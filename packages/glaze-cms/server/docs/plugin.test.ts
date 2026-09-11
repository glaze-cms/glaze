import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveConfig } from '#config';
import { expect, test } from '#harness';
import { createLogger } from '#logger';
import { resolveRuntime } from '#runtime';

import { createGlazeApp } from '../app/index.ts';
import { loadEntities } from '../content/index.ts';
import { resolveOptions } from '../options/index.ts';

import type { DatabaseHandle } from '#dialect';
import type { GlazeContext } from '../app/index.ts';
import type { APIDocsOptions } from '../options/index.ts';

// Contract/HTTP tier: docs generation is dialect-agnostic (built from static TypeBox route schemas) and
// touches no database, so a fake handle stands in and this runs on both runtimes without the matrix.

// A stable secret so composing the Better Auth instance (+ its openAPI reference) is deterministic.
process.env['GLAZE_AUTH_SECRET'] ??= 'glaze-docs-test-secret-0123456789abcdef';

/** Temp `posts` schema fixture under `node_modules` so `drizzle-orm/*` resolves; emitted `.mjs`. */
const TEMP_FIXTURE_PREFIX = join(
	import.meta.dirname,
	'..',
	'..',
	'node_modules',
	'glaze-docs-fixture-',
);

/** A no-op database handle — no docs route queries it. */
function fakeDatabase(): DatabaseHandle {
	return {
		db: {},
		raw: () => Promise.resolve([]),
		transaction: (fn) => fn(() => Promise.resolve([])),
		queryTransaction: (fn) => fn({}),
		ensureSchema: () => Promise.resolve([]),
		close: () => Promise.resolve(),
	};
}

/**
 * Writes a `posts` schema module and composes an app with the given docs options.
 *
 * @param dir - The temp fixture directory.
 * @param docs - Docs options to apply.
 * @returns The composed app.
 */
async function buildApp(dir: string, docs: APIDocsOptions) {
	const path = join(dir, 'posts.mjs');
	writeFileSync(
		path,
		"import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';\n" +
			"export const posts = sqliteTable('posts', { id: integer('id').primaryKey(), title: text('title').notNull() });\n",
	);
	const config = resolveConfig({ dialect: 'sqlite', connection: 'unused', schema: path });
	const context: GlazeContext = {
		db: fakeDatabase(),
		config,
		options: resolveOptions({ docs }),
		logger: createLogger({ level: 'silent' }),
		runtime: resolveRuntime(),
	};
	return createGlazeApp(context, await loadEntities(config));
}

/** GETs a path and returns the Response. */
function get(app: { handle(r: Request): Promise<Response> }, path: string): Promise<Response> {
	return app.handle(new Request(`http://localhost${path}`));
}

test('serves the docs UI and an OpenAPI spec covering the content routes', async () => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const app = await buildApp(dir, {});

		const ui = await get(app, '/openapi');
		expect(ui.status).toBe(200);
		expect(ui.headers.get('content-type')).toContain('text/html');

		const spec = (await (await get(app, '/openapi/json')).json()) as {
			paths: Record<string, unknown>;
		};
		const paths = Object.keys(spec.paths);
		expect(paths).toContain('/api/posts');
		expect(paths).toContain('/api/posts/{id}');
		// The schemaless Better Auth catch-all is excluded from the content spec.
		expect(paths.some((path) => path.startsWith('/api/auth'))).toBe(false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('applies the strict global CSP consistently, including the docs route', async () => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const app = await buildApp(dir, {});

		// The locked baseline is the default on every response — a normal route and the docs page alike.
		const rootCsp = (await get(app, '/')).headers.get('content-security-policy') ?? '';
		expect(rootCsp).toContain("default-src 'self'");

		const docs = await get(app, '/openapi');
		expect(docs.status).toBe(200);
		expect(docs.headers.get('content-security-policy') ?? '').toContain("default-src 'self'");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('serves the Better Auth reference at its own path', async () => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const app = await buildApp(dir, {});
		const ref = await get(app, '/api/auth/reference');
		expect(ref.status).toBe(200);
		expect(ref.headers.get('content-type')).toContain('text/html');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('renders Swagger UI when the provider is swagger', async () => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const app = await buildApp(dir, { provider: 'swagger' });
		const ui = await get(app, '/openapi');
		expect(ui.status).toBe(200);
		expect((await ui.text()).toLowerCase()).toContain('swagger');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('disabled docs serve nothing — content spec and auth reference both 404', async () => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const app = await buildApp(dir, { enabled: false });
		expect((await get(app, '/openapi')).status).toBe(404);
		expect((await get(app, '/api/auth/reference')).status).toBe(404);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('applies custom OpenAPI documentation metadata', async () => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const app = await buildApp(dir, {
			documentation: { info: { title: 'My CMS', version: '9.9.9' } },
		});
		const spec = (await (await get(app, '/openapi/json')).json()) as { info?: { title?: string } };
		expect(spec.info?.title).toBe('My CMS');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
