import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { ENTITLEMENTS } from '@glaze/config';
import { glazeHook } from '../../types';
import { rbacPlugin } from './rbac';

const mockConfig = {
	apiPrefix: '/api',
} as Parameters<typeof rbacPlugin>[0];

type FakeSession = { user: { role: string }; session: object };

function makeAuth(getSession: () => Promise<FakeSession | null>) {
	return { api: { getSession: (_opts: { headers: Headers }) => getSession() } };
}

function buildApp(getSession: () => Promise<FakeSession | null>) {
	return new Elysia()
		.decorate('auth', makeAuth(getSession))
		.use(rbacPlugin(mockConfig))
		.get('/test/writer', () => ({ ok: true }), glazeHook({ requireRole: 'writer' }))
		.get('/test/editor', () => ({ ok: true }), glazeHook({ requireRole: 'editor' }))
		.get('/test/admin', () => ({ ok: true }), glazeHook({ requireRole: 'admin' }));
}

const noSession = () => Promise.resolve(null);
const session = (role: string) => () => Promise.resolve({ user: { role }, session: {} });

// ─── requireRole macro ─────────────────────────────────────────────────────────

describe('requireRole macro', () => {
	describe('unauthenticated', () => {
		it('returns 401 on a writer-guarded route', async () => {
			const app = buildApp(noSession);
			const res = await app.handle(new Request('http://localhost/test/writer'));
			expect(res.status).toBe(401);
		});

		it('returns 401 on an editor-guarded route', async () => {
			const app = buildApp(noSession);
			const res = await app.handle(new Request('http://localhost/test/editor'));
			expect(res.status).toBe(401);
		});

		it('returns 401 on an admin-guarded route', async () => {
			const app = buildApp(noSession);
			const res = await app.handle(new Request('http://localhost/test/admin'));
			expect(res.status).toBe(401);
		});
	});

	describe('insufficient role', () => {
		it('returns 403 when guest tries a writer route', async () => {
			const app = buildApp(session('guest'));
			const res = await app.handle(new Request('http://localhost/test/writer'));
			expect(res.status).toBe(403);
		});

		it('returns 403 when writer tries an editor route', async () => {
			const app = buildApp(session('writer'));
			const res = await app.handle(new Request('http://localhost/test/editor'));
			expect(res.status).toBe(403);
		});

		it('returns 403 when editor tries an admin route', async () => {
			const app = buildApp(session('editor'));
			const res = await app.handle(new Request('http://localhost/test/admin'));
			expect(res.status).toBe(403);
		});
	});

	describe('authorized', () => {
		it('passes for exact role match', async () => {
			const app = buildApp(session('editor'));
			const res = await app.handle(new Request('http://localhost/test/editor'));
			expect(res.status).toBe(200);
		});

		it('passes for a role above the minimum (admin on editor route)', async () => {
			const app = buildApp(session('admin'));
			const res = await app.handle(new Request('http://localhost/test/editor'));
			expect(res.status).toBe(200);
		});

		it('passes for writer accessing a writer route', async () => {
			const app = buildApp(session('writer'));
			const res = await app.handle(new Request('http://localhost/test/writer'));
			expect(res.status).toBe(200);
		});
	});
});

// ─── GET /api/entitlements ─────────────────────────────────────────────────────

describe('GET /api/entitlements', () => {
	it('returns 401 when unauthenticated', async () => {
		const app = buildApp(noSession);
		const res = await app.handle(new Request('http://localhost/api/entitlements'));
		expect(res.status).toBe(401);
	});

	it.each([
		['guest' as const],
		['writer' as const],
		['editor' as const],
		['admin' as const],
	])('returns the correct entitlements for %s', async (role) => {
		const app = buildApp(session(role));
		const res = await app.handle(new Request('http://localhost/api/entitlements'));
		expect(res.status).toBe(200);

		const body = (await res.json()) as { entitlements: string[] };
		const expected = [...ENTITLEMENTS[role]].sort();
		expect(body.entitlements.sort()).toEqual(expected);
	});
});
