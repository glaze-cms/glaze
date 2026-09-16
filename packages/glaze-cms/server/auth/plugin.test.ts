import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveConfig } from '#config';
import { resolveDialect } from '#dialect';
import { expect, matrixTest, test } from '#harness';
import { createLogger } from '#logger';
import { resolveRuntime } from '#runtime';

import { createGlazeApp } from '../app/index.ts';
import { resolveOptions } from '../options/index.ts';
import { materializeAuthTables } from './materializer.ts';

import type { DatabaseHandle, Dialect } from '#dialect';
import type { GlazeApp, GlazeContext } from '../app/index.ts';

// A stable secret so Better Auth signs cookies deterministically across the suite.
process.env['GLAZE_AUTH_SECRET'] ??= 'glaze-integration-test-secret-0123456789abcdef';

/** Builds a Glaze context around a live harness database. */
function buildContext(db: DatabaseHandle, dialect: Dialect): GlazeContext {
	return {
		db,
		config: resolveConfig({ dialect, connection: 'unused' }),
		options: resolveOptions({}),
		logger: createLogger({ level: 'silent' }),
		runtime: resolveRuntime(),
	};
}

/** Materializes the auth tables and returns a composed app bound to the database. */
async function bootAuthApp(db: DatabaseHandle, dialect: Dialect): Promise<GlazeApp> {
	const context = buildContext(db, dialect);
	await materializeAuthTables(context);
	return createGlazeApp(context, []);
}

/** POSTs a JSON body to an auth route. */
function postJson(app: GlazeApp, path: string, body: unknown): Promise<Response> {
	return app.handle(
		new Request(`http://localhost${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}),
	);
}

/** Extracts the `better-auth.session_token=…` cookie pair from a response, for echoing back. */
function sessionCookie(response: Response): string {
	const tokenCookie = response.headers
		.getSetCookie()
		.find((cookie) => cookie.startsWith('better-auth.session_token='));
	if (!tokenCookie) throw new Error('no session cookie set');
	return tokenCookie.split(';')[0] ?? '';
}

/** The users table, dialect-qualified. */
function usersTable(dialect: Dialect): string {
	return dialect === 'postgres' ? 'glaze_auth.users' : 'zz__glaze_auth_users';
}

const CREDENTIALS = { email: 'ada@example.com', password: 'correct-horse-battery', name: 'Ada' };

matrixTest(
	'sign-up persists a user and both cookie + bearer sessions authenticate',
	async ({ db, dialect }) => {
		const app = await bootAuthApp(db, dialect);

		// Sign-up creates the user row and returns a session cookie.
		const signUp = await postJson(app, '/api/auth/sign-up/email', CREDENTIALS);
		expect(signUp.status).toBe(200);
		const cookie = sessionCookie(signUp);

		const rows = await db.raw(`select email from ${usersTable(dialect)}`);
		expect(rows).toHaveLength(1);
		expect(String(rows[0]?.['email'])).toBe(CREDENTIALS.email);

		// The cookie authenticates the same-origin admin path.
		const byCookie = await app.handle(
			new Request('http://localhost/api/auth/get-session', { headers: { cookie } }),
		);
		const cookieBody = (await byCookie.json()) as { user?: { email?: string } } | null;
		expect(cookieBody?.user?.email).toBe(CREDENTIALS.email);

		// The same signed token authenticates the external-API path as a Bearer credential.
		const token = cookie.split('=')[1] ?? '';
		const byBearer = await app.handle(
			new Request('http://localhost/api/auth/get-session', {
				headers: { authorization: `Bearer ${token}` },
			}),
		);
		const bearerBody = (await byBearer.json()) as { user?: { email?: string } } | null;
		expect(bearerBody?.user?.email).toBe(CREDENTIALS.email);
	},
);

matrixTest('security headers are present on auth responses', async ({ db, dialect }) => {
	const app = await bootAuthApp(db, dialect);
	const response = await app.handle(new Request('http://localhost/api/auth/get-session'));
	expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});

// Rate limiting lives in Better Auth (HTTP layer, keyed by ip|path), so it is dialect-agnostic — a
// single SQLite instance proves it works through the mount. Kept off the matrix on purpose: Better
// Auth's in-memory limiter is process-global, so a per-dialect re-run would inherit an exhausted bucket.
test("Better Auth's built-in rate limiter returns 429 on repeated sign-ins", async () => {
	const directory = mkdtempSync(join(tmpdir(), 'glaze-auth-rl-'));
	const handle = await resolveDialect('sqlite').createDatabase({
		connection: join(directory, 'rl.db'),
	});
	// The rest of the suite disables Better Auth's rate limiter (see `./instance.ts`) because every
	// `app.handle()` call in-process shares its single fallback bucket; this is the one spec that
	// needs it live, so it opts back in for the duration of the test.
	process.env['GLAZE_TEST_RATE_LIMIT'] = '1';
	try {
		const app = await bootAuthApp(handle, 'sqlite');

		// Better Auth's default special rule limits /sign-in to 3 per 10s window; the 4th+ is limited.
		const statuses: number[] = [];
		for (let attempt = 0; attempt < 5; attempt++) {
			// Sequential on purpose: the limiter counts requests in order, so these must not be parallel.
			// eslint-disable-next-line no-await-in-loop
			const response = await postJson(app, '/api/auth/sign-in/email', {
				email: 'nobody@example.com',
				password: 'wrong-password',
			});
			statuses.push(response.status);
		}

		expect(statuses.includes(429)).toBe(true);
		// The first attempt is the limiter working, not a blanket block.
		expect(statuses[0]).toBe(401);
	} finally {
		delete process.env['GLAZE_TEST_RATE_LIMIT'];
		await handle.close();
		rmSync(directory, { recursive: true, force: true });
	}
});
