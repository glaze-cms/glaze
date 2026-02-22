import { describe, it, expect, mock, spyOn } from 'bun:test';
import type { Logger } from '@glaze/logger';
import type { GlazeInternalConfig, GlazeEnv } from '@glaze/config';

const mockDb = { execute: async () => [{ '?column?': 1 }] };

mock.module('drizzle-orm/node-postgres', () => ({
	drizzle: () => mockDb,
}));

mock.module('better-auth', () => ({
	betterAuth: () => ({
		handler: (_req: Request) => new Response('auth ok'),
		api: { getSession: async () => null },
	}),
}));

mock.module('better-auth/adapters/drizzle', () => ({
	drizzleAdapter: () => ({}),
}));

import { createGlazeServer } from './server';

const createMockLogger = (): Logger =>
	({
		warn: () => {},
		info: () => {},
		error: () => {},
		debug: () => {},
		trace: () => {},
		fatal: () => {},
		silent: () => {},
		level: 'info',
		msgPrefix: '',
		child: () => createMockLogger(),
	}) as unknown as Logger;

const createMockEnv = (): GlazeEnv => ({
	NODE_ENV: 'development',
	GLAZE_AUTH_SECRET: 'a'.repeat(32),
	GLAZE_PORT: 4000,
	GLAZE_DATABASE_URL: 'postgres://localhost:5432/test',
});

const createTestConfig = (): GlazeInternalConfig =>
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
	}) as GlazeInternalConfig;

describe('createGlazeServer', () => {
	it('should return an Elysia instance', () => {
		const server = createGlazeServer({
			env: createMockEnv(),
			config: createTestConfig(),
			logger: createMockLogger(),
		});

		expect(server).toBeDefined();
	});

	it('should register root route that returns server info', async () => {
		const server = createGlazeServer({
			env: createMockEnv(),
			config: createTestConfig(),
			logger: createMockLogger(),
		});

		const response = await server.handle(new Request('http://localhost/'));
		const body = (await response.json()) as {
			message: string;
			admin: string;
			health: string;
		};

		expect(response.status).toBe(200);
		expect(body.message).toBe('Glaze CMS Server');
	});

	it('should include admin prefix in root response', async () => {
		const config = createTestConfig();
		config.adminPrefix = '/dashboard';

		const server = createGlazeServer({
			env: createMockEnv(),
			config,
			logger: createMockLogger(),
		});

		const response = await server.handle(new Request('http://localhost/'));
		const body = (await response.json()) as { admin: string };

		expect(body.admin).toBe('/dashboard');
	});

	it('should include health check path in root response', async () => {
		const config = createTestConfig();
		config.healthCheck.path = '/healthz';

		const server = createGlazeServer({
			env: createMockEnv(),
			config,
			logger: createMockLogger(),
		});

		const response = await server.handle(new Request('http://localhost/'));
		const body = (await response.json()) as { health: string };

		expect(body.health).toBe('/healthz');
	});

	it('should log admin dashboard URL on creation', () => {
		const mockLogger = createMockLogger();
		const infoSpy = spyOn(mockLogger, 'info');

		createGlazeServer({
			env: createMockEnv(),
			config: createTestConfig(),
			logger: mockLogger,
		});

		expect(infoSpy).toHaveBeenCalledWith(
			expect.stringContaining('Glaze Admin Dashboard available at'),
		);
	});

	it('should use GLAZE_SERVER_URL in admin dashboard log when available', () => {
		const mockLogger = createMockLogger();
		const infoSpy = spyOn(mockLogger, 'info');
		const env = createMockEnv();
		(env as any).GLAZE_SERVER_URL = 'https://myapp.com';

		createGlazeServer({
			env,
			config: createTestConfig(),
			logger: mockLogger,
		});

		expect(infoSpy).toHaveBeenCalledWith(
			expect.stringContaining('https://myapp.com/admin'),
		);
	});

	it('should fall back to localhost in admin dashboard log', () => {
		const mockLogger = createMockLogger();
		const infoSpy = spyOn(mockLogger, 'info');

		createGlazeServer({
			env: createMockEnv(),
			config: createTestConfig(),
			logger: mockLogger,
		});

		expect(infoSpy).toHaveBeenCalledWith(
			expect.stringContaining('http://localhost:4000/admin'),
		);
	});
});
