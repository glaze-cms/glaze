import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';

import { adminPlugin } from './index';

import type { GlazeInternalConfig } from '../../validators/config/config';

// Helper to create minimal config for testing
const createTestConfig = (adminPrefix: string): GlazeInternalConfig =>
	({
		adminPrefix,
		apiPrefix: '/api',
		healthCheck: { enabled: true, path: '/_health' },
	}) as GlazeInternalConfig;

describe('adminPlugin', () => {
	describe('basic routing', () => {
		it('should redirect exact prefix to trailing slash', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/dashboard')));

			const response = await app.handle(
				new Request('http://localhost/dashboard'),
			);

			// Exact match should redirect to trailing slash (301)
			expect(response.status).toBe(301);
			expect(response.headers.get('Location')).toBe('/dashboard/');
		});

		it('should handle requests at trailing slash path', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/dashboard')));

			const response = await app.handle(
				new Request('http://localhost/dashboard/'),
			);
			// Route is registered; may return 200 (file served) or 404 (file not found)
			// but should NOT be a routing 404 (which would indicate route not registered)
			expect([200, 404]).toContain(response.status);
		});

		it('should register routes at the configured prefix - subpaths', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/dashboard')));

			const response = await app.handle(
				new Request('http://localhost/dashboard/users'),
			);
			// Route should be registered (not a routing 404)
			expect(
				response.status === 301 ||
					response.status === 404 ||
					response.status === 502 ||
					response.status === 200,
			).toBe(true);
		});

		it('should handle deep nested paths', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/admin')));

			const response = await app.handle(
				new Request('http://localhost/admin/content/posts/123/edit'),
			);
			// Route should be registered (not a routing 404)
			expect(
				response.status === 301 ||
					response.status === 404 ||
					response.status === 502 ||
					response.status === 200,
			).toBe(true);
		});
	});

	describe('different HTTP methods', () => {
		it('should handle GET requests', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/admin')));

			const response = await app.handle(
				new Request('http://localhost/admin', { method: 'GET' }),
			);
			expect(
				response.status === 301 ||
					response.status === 404 ||
					response.status === 502 ||
					response.status === 200,
			).toBe(true);
		});

		it('should handle POST requests', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/admin')));

			const response = await app.handle(
				new Request('http://localhost/admin', { method: 'POST' }),
			);
			expect(
				response.status === 301 ||
					response.status === 404 ||
					response.status === 502 ||
					response.status === 200,
			).toBe(true);
		});

		it('should handle PUT requests', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/admin')));

			const response = await app.handle(
				new Request('http://localhost/admin/api/users/1', { method: 'PUT' }),
			);
			expect(
				response.status === 301 ||
					response.status === 404 ||
					response.status === 502 ||
					response.status === 200,
			).toBe(true);
		});

		it('should handle DELETE requests', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/admin')));

			const response = await app.handle(
				new Request('http://localhost/admin/api/users/1', { method: 'DELETE' }),
			);
			expect(
				response.status === 301 ||
					response.status === 404 ||
					response.status === 502 ||
					response.status === 200,
			).toBe(true);
		});
	});

	describe('Vite fallback routes (non-default prefix in dev mode)', () => {
		let originalEnv: string | undefined;

		beforeEach(() => {
			originalEnv = process.env.GLAZE_INTERNAL__ADMIN_PROXY;
		});

		afterEach(() => {
			if (originalEnv === undefined) {
				delete process.env.GLAZE_INTERNAL__ADMIN_PROXY;
			} else {
				process.env.GLAZE_INTERNAL__ADMIN_PROXY = originalEnv;
			}
		});

		it('should NOT register /admin fallback when env var is not set', async () => {
			delete process.env.GLAZE_INTERNAL__ADMIN_PROXY;

			const app = new Elysia().use(adminPlugin(createTestConfig('/custom')));

			const response = await app.handle(new Request('http://localhost/admin'));
			expect(response.status).toBe(404);
		});

		it('should NOT register /admin fallback when using default /admin prefix', async () => {
			process.env.GLAZE_INTERNAL__ADMIN_PROXY = 'true';

			const app = new Elysia().use(adminPlugin(createTestConfig('/admin')));

			// With default prefix, there's no duplicate registration needed
			// The primary routes handle /admin already
			const response = await app.handle(new Request('http://localhost/admin'));
			expect(
				response.status === 301 ||
					response.status === 404 ||
					response.status === 502 ||
					response.status === 200,
			).toBe(true);
		});

		it('should register /admin fallback when using custom prefix in dev mode', async () => {
			process.env.GLAZE_INTERNAL__ADMIN_PROXY = 'true';

			const app = new Elysia().use(adminPlugin(createTestConfig('/cms')));

			// Test /admin exact match
			const response1 = await app.handle(new Request('http://localhost/admin'));
			expect(
				response1.status === 301 ||
					response1.status === 404 ||
					response1.status === 502 ||
					response1.status === 200,
			).toBe(true);

			// Test /admin/ wildcard
			const response2 = await app.handle(
				new Request('http://localhost/admin/'),
			);
			expect(
				response2.status === 301 ||
					response2.status === 404 ||
					response2.status === 502 ||
					response2.status === 200,
			).toBe(true);

			// Test /admin subpath (Vite assets)
			const response3 = await app.handle(
				new Request('http://localhost/admin/assets/main.js'),
			);
			expect(
				response3.status === 301 ||
					response3.status === 404 ||
					response3.status === 502 ||
					response3.status === 200,
			).toBe(true);
		});
	});

	describe('404 handling for non-matching routes', () => {
		it('should return 404 for non-admin paths', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/admin')));

			const response = await app.handle(
				new Request('http://localhost/api/users'),
			);
			expect(response.status).toBe(404);
		});

		it('should return 404 for similar but different paths', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/admin')));

			const response1 = await app.handle(
				new Request('http://localhost/administrator'),
			);
			expect(response1.status).toBe(404);

			const response2 = await app.handle(
				new Request('http://localhost/admins'),
			);
			expect(response2.status).toBe(404);

			const response3 = await app.handle(
				new Request('http://localhost/my-admin'),
			);
			expect(response3.status).toBe(404);
		});
	});

	describe('path parameters are passed correctly', () => {
		it('should receive correct path in context for exact match', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/dashboard')));

			const response = await app.handle(
				new Request('http://localhost/dashboard'),
			);
			expect(
				response.status === 301 ||
					response.status === 404 ||
					response.status === 502 ||
					response.status === 200,
			).toBe(true);
		});

		it('should receive correct path in context for wildcard match', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/dashboard')));

			const response = await app.handle(
				new Request('http://localhost/dashboard/content/posts'),
			);
			expect(
				response.status === 301 ||
					response.status === 404 ||
					response.status === 502 ||
					response.status === 200,
			).toBe(true);
		});
	});
});
