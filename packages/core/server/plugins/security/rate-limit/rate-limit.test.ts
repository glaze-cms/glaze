import { Elysia } from 'elysia';
import { describe, expect, it, spyOn } from 'bun:test';
import type { Logger } from '@glaze/logger';
import type { GlazeEnv } from '@glaze/config';
import { rateLimitPlugin } from './rate-limit';

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

const createMockEnv = (nodeEnv: string): GlazeEnv => ({
	NODE_ENV: nodeEnv as GlazeEnv['NODE_ENV'],
	GLAZE_AUTH_SECRET: 'a'.repeat(32),
	GLAZE_PORT: 4000,
	GLAZE_DATABASE_URL: 'postgres://localhost:5432/test',
});

const createDefaultRateLimitConfig = () => ({
	enabled: true,
	max: 60,
	duration: 60000,
});

describe('rateLimitPlugin', () => {
	describe('production warning', () => {
		it('should warn when rate limiting is disabled in production', () => {
			const mockLogger = createMockLogger();
			const mockEnv = createMockEnv('production');
			const warnSpy = spyOn(mockLogger, 'warn');

			rateLimitPlugin(
				{
					rateLimit: { enabled: false, max: 60, duration: 60000 },
					cors: { methods: [], allowedHeaders: [] },
				},
				mockEnv,
				mockLogger,
			);

			expect(warnSpy).toHaveBeenCalledWith(
				'Rate limiting is not enabled in production. This may expose your application to DDoS attacks.',
			);
		});

		it('should not warn when rate limiting is enabled in production', () => {
			const mockLogger = createMockLogger();
			const mockEnv = createMockEnv('production');
			const warnSpy = spyOn(mockLogger, 'warn');

			rateLimitPlugin(
				{
					rateLimit: createDefaultRateLimitConfig(),
					cors: { methods: [], allowedHeaders: [] },
				},
				mockEnv,
				mockLogger,
			);

			expect(warnSpy).not.toHaveBeenCalled();
		});

		it('should not warn in development mode when disabled', () => {
			const mockLogger = createMockLogger();
			const mockEnv = createMockEnv('development');
			const warnSpy = spyOn(mockLogger, 'warn');

			rateLimitPlugin(
				{
					rateLimit: { enabled: false, max: 60, duration: 60000 },
					cors: { methods: [], allowedHeaders: [] },
				},
				mockEnv,
				mockLogger,
			);

			expect(warnSpy).not.toHaveBeenCalled();
		});

		it('should not warn in local mode when disabled', () => {
			const mockLogger = createMockLogger();
			const mockEnv = createMockEnv('local');
			const warnSpy = spyOn(mockLogger, 'warn');

			rateLimitPlugin(
				{
					rateLimit: { enabled: false, max: 60, duration: 60000 },
					cors: { methods: [], allowedHeaders: [] },
				},
				mockEnv,
				mockLogger,
			);

			expect(warnSpy).not.toHaveBeenCalled();
		});

		it('should not throw when logger is not provided', () => {
			const mockEnv = createMockEnv('production');

			expect(() =>
				rateLimitPlugin(
					{
						rateLimit: { enabled: false, max: 60, duration: 60000 },
						cors: { methods: [], allowedHeaders: [] },
					},
					mockEnv,
				),
			).not.toThrow();
		});
	});

	describe('environment-based defaults', () => {
		it('should skip middleware in development when enabled is false (default)', async () => {
			const mockEnv = createMockEnv('development');

			const app = new Elysia()
				.use(
					rateLimitPlugin(
						{
							rateLimit: { enabled: false, max: 60, duration: 60000 },
							cors: { methods: [], allowedHeaders: [] },
						},
						mockEnv,
					),
				)
				.get('/test', () => 'ok');

			const response = await app.handle(new Request('http://localhost/test'));
			expect(response.headers.has('RateLimit-Limit')).toBe(false);
		});

		it('should apply middleware in development when enabled is explicitly true', async () => {
			const mockEnv = createMockEnv('development');

			const app = new Elysia()
				.use(
					rateLimitPlugin(
						{
							rateLimit: { enabled: true, max: 60, duration: 60000 },
							cors: { methods: [], allowedHeaders: [] },
						},
						mockEnv,
					),
				)
				.get('/test', () => 'ok');

			const response = await app.handle(new Request('http://localhost/test'));
			expect(response.headers.has('RateLimit-Limit')).toBe(true);
		});

		it('should skip middleware in local when enabled is false (default)', async () => {
			const mockEnv = createMockEnv('local');

			const app = new Elysia()
				.use(
					rateLimitPlugin(
						{
							rateLimit: { enabled: false, max: 60, duration: 60000 },
							cors: { methods: [], allowedHeaders: [] },
						},
						mockEnv,
					),
				)
				.get('/test', () => 'ok');

			const response = await app.handle(new Request('http://localhost/test'));
			expect(response.headers.has('RateLimit-Limit')).toBe(false);
		});

		it('should apply middleware in production when enabled is true (default)', async () => {
			const mockEnv = createMockEnv('production');

			const app = new Elysia()
				.use(
					rateLimitPlugin(
						{
							rateLimit: { enabled: true, max: 60, duration: 60000 },
							cors: { methods: [], allowedHeaders: [] },
						},
						mockEnv,
					),
				)
				.get('/test', () => 'ok');

			const response = await app.handle(new Request('http://localhost/test'));
			expect(response.headers.has('RateLimit-Limit')).toBe(true);
		});
	});

	describe('configuration handling', () => {
		it('should accept custom max configuration', () => {
			const mockEnv = createMockEnv('production');

			const plugin = rateLimitPlugin(
				{
					rateLimit: { enabled: true, max: 100, duration: 60000 },
					cors: { methods: [], allowedHeaders: [] },
				},
				mockEnv,
				createMockLogger(),
			);

			expect(plugin).toBeDefined();
		});

		it('should accept custom duration configuration', () => {
			const mockEnv = createMockEnv('production');

			const plugin = rateLimitPlugin(
				{
					rateLimit: { enabled: true, max: 60, duration: 300000 },
					cors: { methods: [], allowedHeaders: [] },
				},
				mockEnv,
				createMockLogger(),
			);

			expect(plugin).toBeDefined();
		});

		it('should handle custom generator function', () => {
			const mockEnv = createMockEnv('production');
			const customGenerator = (_req: Request, _server: unknown) => 'custom-key';

			const plugin = rateLimitPlugin(
				{
					rateLimit: {
						enabled: true,
						max: 60,
						duration: 60000,
						generator: customGenerator,
					},
					cors: { methods: [], allowedHeaders: [] },
				},
				mockEnv,
				createMockLogger(),
			);

			expect(plugin).toBeDefined();
		});

		it('should handle multiple rate limit options together', () => {
			const mockEnv = createMockEnv('production');
			const customGenerator = (_req: Request, _server: unknown) => 'custom-key';

			const plugin = rateLimitPlugin(
				{
					rateLimit: {
						enabled: true,
						max: 120,
						duration: 120000,
						generator: customGenerator,
					},
					cors: { methods: [], allowedHeaders: [] },
				},
				mockEnv,
				createMockLogger(),
			);

			expect(plugin).toBeDefined();
		});
	});
});
