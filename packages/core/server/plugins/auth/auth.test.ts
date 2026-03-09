import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import type { GlazeInternalConfig, GlazeEnv } from '@glaze/config';

const mockBetterAuth = mock(() => ({
	handler: (_req: Request) => new Response('auth ok'),
	api: { getSession: () => Promise.resolve(null) },
}));

const mockDrizzleAdapter = mock(() => ({}));

void mock.module('better-auth', () => ({
	betterAuth: mockBetterAuth,
}));

void mock.module('better-auth/adapters/drizzle', () => ({
	drizzleAdapter: mockDrizzleAdapter,
}));

import { authPlugin } from './auth';

const createMockEnv = (overrides?: Partial<GlazeEnv>): GlazeEnv => ({
	NODE_ENV: 'development',
	GLAZE_AUTH_SECRET: 'a'.repeat(32),
	GLAZE_PORT: 4000,
	GLAZE_DATABASE_URL: 'postgres://localhost:5432/test',
	...overrides,
});

const createTestConfig = (
	overrides?: Partial<GlazeInternalConfig>,
): GlazeInternalConfig =>
	({
		apiPrefix: '/api',
		adminPrefix: '/admin',
		schema: {},
		security: {
			cors: {
				methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
				allowedHeaders: ['Content-Type', 'Authorization'],
			},
			rateLimit: { enabled: true, max: 60, duration: 60000 },
		},
		healthCheck: { enabled: true, path: '/_health' },
		auth: {
			appName: 'Glaze CMS',
			basePath: '/api/auth',
			publicAuthEnabled: true,
			emailAndPassword: { enabled: true },
		},
		...overrides,
	}) as GlazeInternalConfig;

describe('authPlugin', () => {
	beforeEach(() => {
		mockBetterAuth.mockClear();
		mockDrizzleAdapter.mockClear();
	});

	it('should return a plugin function', () => {
		const plugin = authPlugin(createTestConfig(), createMockEnv());
		expect(typeof plugin).toBe('function');
	});

	it('should call betterAuth with correct appName', () => {
		const mockDb = {};

		new Elysia()
			.decorate('db', mockDb)
			.use(authPlugin(createTestConfig(), createMockEnv()));

		expect(mockBetterAuth).toHaveBeenCalledWith(
			expect.objectContaining({ appName: 'Glaze CMS' }),
		);
	});

	it('should configure basePath from apiPrefix', () => {
		const mockDb = {};

		new Elysia()
			.decorate('db', mockDb)
			.use(
				authPlugin(
					createTestConfig({ apiPrefix: '/custom-api' }),
					createMockEnv(),
				),
			);

		expect(mockBetterAuth).toHaveBeenCalledWith(
			expect.objectContaining({ basePath: '/custom-api/auth' }),
		);
	});

	it('should use GLAZE_SERVER_URL as baseURL when available', () => {
		const mockDb = {};

		const env = createMockEnv({
			GLAZE_SERVER_URL: 'https://myapp.com',
		});

		new Elysia()
			.decorate('db', mockDb)
			.use(authPlugin(createTestConfig(), env));

		expect(mockBetterAuth).toHaveBeenCalledWith(
			expect.objectContaining({ baseURL: 'https://myapp.com' }),
		);
	});

	it('should fall back to localhost URL when GLAZE_SERVER_URL is not set', () => {
		const mockDb = {};
		const env = createMockEnv();

		new Elysia()
			.decorate('db', mockDb)
			.use(authPlugin(createTestConfig(), env));

		expect(mockBetterAuth).toHaveBeenCalledWith(
			expect.objectContaining({ baseURL: 'http://localhost:4000' }),
		);
	});

	it('should use correct port in fallback URL', () => {
		const mockDb = {};
		const env = createMockEnv({ GLAZE_PORT: 8080 });

		new Elysia()
			.decorate('db', mockDb)
			.use(authPlugin(createTestConfig(), env));

		expect(mockBetterAuth).toHaveBeenCalledWith(
			expect.objectContaining({ baseURL: 'http://localhost:8080' }),
		);
	});

	it('should disable better-auth rate limiting', () => {
		const mockDb = {};

		new Elysia()
			.decorate('db', mockDb)
			.use(authPlugin(createTestConfig(), createMockEnv()));

		expect(mockBetterAuth).toHaveBeenCalledWith(
			expect.objectContaining({ rateLimit: { enabled: false } }),
		);
	});

	it('should pass GLAZE_AUTH_SECRET as secret', () => {
		const mockDb = {};
		const secret = 'b'.repeat(32);
		const env = createMockEnv({ GLAZE_AUTH_SECRET: secret });

		new Elysia()
			.decorate('db', mockDb)
			.use(authPlugin(createTestConfig(), env));

		expect(mockBetterAuth).toHaveBeenCalledWith(
			expect.objectContaining({ secret }),
		);
	});

	it('should enable email and password authentication', () => {
		const mockDb = {};

		new Elysia()
			.decorate('db', mockDb)
			.use(authPlugin(createTestConfig(), createMockEnv()));

		expect(mockBetterAuth).toHaveBeenCalledWith(
			expect.objectContaining({
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				emailAndPassword: expect.objectContaining({ enabled: true }),
			}),
		);
	});

	it('should call drizzleAdapter with db and pg provider', () => {
		const mockDb = { mockDb: true };

		new Elysia()
			.decorate('db', mockDb)
			.use(authPlugin(createTestConfig(), createMockEnv()));

		expect(mockDrizzleAdapter).toHaveBeenCalledWith(
			mockDb,
			expect.objectContaining({
				provider: 'pg',
				usePlural: true,
			}),
		);
	});

	describe('plugins', () => {
		const getCalledPlugins = () =>
			(
				mockBetterAuth.mock.calls as unknown as Array<[{ plugins: unknown[] }]>
			)[0]?.[0]?.plugins ?? [];

		it('should pass user-provided plugins to betterAuth', () => {
			const userPlugin = { id: 'my-plugin' };
			const config = createTestConfig({
				auth: {
					...createTestConfig().auth,
					plugins: [userPlugin],
				},
			});

			new Elysia().decorate('db', {}).use(authPlugin(config, createMockEnv()));

			expect(getCalledPlugins()).toContain(userPlugin);
		});

		it('should pass undefined when no plugins provided', () => {
			new Elysia()
				.decorate('db', {})
				.use(authPlugin(createTestConfig(), createMockEnv()));

			expect(getCalledPlugins()).toEqual([]);
		});
	});
});
