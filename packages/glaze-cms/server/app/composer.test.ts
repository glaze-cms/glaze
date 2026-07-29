import { resolveConfig } from '#config';
import { expect, test } from '#harness';
import { createLogger } from '#logger';
import { resolveRuntime } from '#runtime';

import { resolveOptions } from '../options/index.ts';
import { createGlazeApp } from './composer.ts';

import type { DatabaseHandle } from '#dialect';
import type { GlazeContext } from './context.ts';

// Contract/HTTP tier: build the app in-memory and assert on `app.handle(new Request())`. No DB is
// touched — a minimal fake handle stands in for the dialect seam.

/** A no-op database handle for contract tests (no route here queries it). */
function fakeDatabase(): DatabaseHandle {
	return {
		db: {},
		raw: () => Promise.resolve([]),
		transaction: (fn) => fn(() => Promise.resolve([])),
		ensureSchema: () => Promise.resolve([]),
		close: () => Promise.resolve(),
	};
}

/** Builds a Glaze context with fakes, for composing an app in-memory. */
function testContext(): GlazeContext {
	return {
		db: fakeDatabase(),
		config: resolveConfig({ dialect: 'sqlite', connection: ':memory:' }),
		options: resolveOptions({}),
		logger: createLogger({ level: 'silent' }),
		runtime: resolveRuntime(),
	};
}

/** Sends an in-memory GET and returns the Response. */
async function get(app: ReturnType<typeof createGlazeApp>, path: string): Promise<Response> {
	return app.handle(new Request(`http://localhost${path}`));
}

test('health route returns ok', async () => {
	const app = createGlazeApp(testContext(), []);
	const response = await get(app, '/_health');
	expect(response.status).toBe(200);

	const body = (await response.json()) as { status: string };
	expect(body.status).toBe('ok');
});

test('root route returns the discovery manifest', async () => {
	const app = createGlazeApp(testContext(), []);
	const response = await get(app, '/');
	expect(response.status).toBe(200);

	const body = (await response.json()) as { name: string; apiPrefix: string };
	expect(body.name).toBe('glaze');
	expect(body.apiPrefix).toBe('/api');
});

test('a strict security header is set on responses', async () => {
	const app = createGlazeApp(testContext(), []);
	const response = await get(app, '/_health');
	expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});

test('the returned app is chainable — a user route is served', async () => {
	const app = createGlazeApp(testContext(), []);
	app.get('/newsletter', () => 'signed up');
	const response = await get(app, '/newsletter');
	expect(response.status).toBe(200);
	expect(await response.text()).toBe('signed up');
});

test('security headers are set even on a 404 (not just handled routes)', async () => {
	const app = createGlazeApp(testContext(), []);
	const response = await get(app, '/does-not-exist');
	expect(response.status).toBe(404);
	// the response attackers probe most must still carry the headers
	expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
	expect(response.headers.get('x-frame-options')).toBe('DENY');
});
