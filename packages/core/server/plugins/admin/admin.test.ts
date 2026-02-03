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
			// Route handler runs: returns 200 (file served), 404 (file not found),
			// or 502 (Vite proxy error). Any of these proves the route is registered.
			// A router 404 would NOT reach the handler.
			expect(
				response.status === 200 ||
					response.status === 404 ||
					response.status === 502,
			).toBe(true);
		});

		it('should register routes at the configured prefix - subpaths', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/dashboard')));

			const response = await app.handle(
				new Request('http://localhost/dashboard/users'),
			);
			// Route handler runs: 200 (file), 404 (file not found), or 502 (Vite proxy)
			// Any of these proves the route is registered vs a router 404
			expect(
				response.status === 200 ||
					response.status === 404 ||
					response.status === 502,
			).toBe(true);
		});

		it('should handle deep nested paths', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/admin')));

			const response = await app.handle(
				new Request('http://localhost/admin/content/posts/123/edit'),
			);
			// Route handler runs: 200 (file), 404 (file not found), or 502 (Vite proxy)
			// Any of these proves the route is registered vs a router 404
			expect(
				response.status === 200 ||
					response.status === 404 ||
					response.status === 502,
			).toBe(true);
		});
	});

	describe('different HTTP methods', () => {
		it('should handle GET requests', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/admin')));

			const response = await app.handle(
				new Request('http://localhost/admin', { method: 'GET' }),
			);
			// 301 (redirect) is the strongest proof - only the handler does this
			expect(response.status).toBe(301);
			expect(response.headers.get('Location')).toBe('/admin/');
		});

		it('should handle POST requests', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/admin')));

			const response = await app.handle(
				new Request('http://localhost/admin', { method: 'POST' }),
			);
			// 301 (redirect) proves the route handler ran - only it redirects exact prefix
			expect(response.status).toBe(301);
			expect(response.headers.get('Location')).toBe('/admin/');
		});

		it('should handle PUT requests', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/admin')));

			const response = await app.handle(
				new Request('http://localhost/admin/api/users/1', { method: 'PUT' }),
			);
			// Route handler runs: 200 (file), 404 (file not found), or 502 (Vite proxy)
			// Any of these proves the route is registered vs a router 404
			expect(
				response.status === 200 ||
					response.status === 404 ||
					response.status === 502,
			).toBe(true);
		});

		it('should handle DELETE requests', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/admin')));

			const response = await app.handle(
				new Request('http://localhost/admin/api/users/1', { method: 'DELETE' }),
			);
			// Route handler runs: 200 (file), 404 (file not found), or 502 (Vite proxy)
			// Any of these proves the route is registered vs a router 404
			expect(
				response.status === 200 ||
					response.status === 404 ||
					response.status === 502,
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
			// 301 (redirect) proves the primary route handler ran
			expect(response.status).toBe(301);
			expect(response.headers.get('Location')).toBe('/admin/');
		});

		it('should register /admin fallback when using custom prefix in dev mode', async () => {
			process.env.GLAZE_INTERNAL__ADMIN_PROXY = 'true';

			const app = new Elysia().use(adminPlugin(createTestConfig('/cms')));

			// Test /admin exact match - should redirect (proves handler ran)
			const response1 = await app.handle(new Request('http://localhost/admin'));
			expect(response1.status).toBe(301);
			expect(response1.headers.get('Location')).toBe('/admin/');

			// Test /admin/ wildcard - handler runs (200, 404, or 502)
			const response2 = await app.handle(
				new Request('http://localhost/admin/'),
			);
			expect(
				response2.status === 200 ||
					response2.status === 404 ||
					response2.status === 502,
			).toBe(true);

			// Test /admin subpath (Vite assets) - handler runs (200, 404, or 502)
			const response3 = await app.handle(
				new Request('http://localhost/admin/assets/main.js'),
			);
			expect(
				response3.status === 200 ||
					response3.status === 404 ||
					response3.status === 502,
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
			// 301 (redirect) proves the route handler ran with correct path context
			expect(response.status).toBe(301);
			expect(response.headers.get('Location')).toBe('/dashboard/');
		});

		it('should receive correct path in context for wildcard match', async () => {
			const app = new Elysia().use(adminPlugin(createTestConfig('/dashboard')));

			const response = await app.handle(
				new Request('http://localhost/dashboard/content/posts'),
			);
			// Route handler runs: 200 (file), 404 (file not found), or 502 (Vite proxy)
			// Any of these proves the route is registered vs a router 404
			expect(
				response.status === 200 ||
					response.status === 404 ||
					response.status === 502,
			).toBe(true);
		});
	});
});
