import { describe, expect, it, spyOn, beforeEach, afterEach } from 'bun:test';
import type { Logger } from '@glaze/logger';
import type { GlazeEnv } from '../../../validators/env';
import {
	DEFAULT_CORS_METHODS,
	DEFAULT_CORS_ALLOWED_HEADERS,
} from '../../../lib/consts';
import { corsPlugin } from './cors';

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

const createDefaultCorsConfig = () => ({
	methods: [...DEFAULT_CORS_METHODS],
	allowedHeaders: [...DEFAULT_CORS_ALLOWED_HEADERS],
});

describe('corsPlugin', () => {
	let originalNodeEnv: string | undefined;

	beforeEach(() => {
		originalNodeEnv = process.env.NODE_ENV;
	});

	afterEach(() => {
		if (originalNodeEnv === undefined) {
			delete process.env.NODE_ENV;
		} else {
			process.env.NODE_ENV = originalNodeEnv;
		}
	});

	describe('production warning', () => {
		it('should warn when no origins configured in production', () => {
			process.env.NODE_ENV = 'production';

			const mockLogger = createMockLogger();
			const mockEnv = createMockEnv('production');
			const warnSpy = spyOn(mockLogger, 'warn');

			corsPlugin({ cors: createDefaultCorsConfig() }, mockEnv, mockLogger);

			expect(warnSpy).toHaveBeenCalledWith(
				'No CORS origins configured in production. All cross-origin requests will be blocked.',
			);
		});

		it('should not warn when origins are configured in production', () => {
			process.env.NODE_ENV = 'production';

			const mockLogger = createMockLogger();
			const mockEnv = createMockEnv('production');
			const warnSpy = spyOn(mockLogger, 'warn');

			corsPlugin(
				{
					cors: { ...createDefaultCorsConfig(), origin: ['https://myapp.com'] },
				},
				mockEnv,
				mockLogger,
			);

			expect(warnSpy).not.toHaveBeenCalled();
		});

		it('should not warn in development mode', () => {
			process.env.NODE_ENV = 'development';

			const mockLogger = createMockLogger();
			const mockEnv = createMockEnv('development');
			const warnSpy = spyOn(mockLogger, 'warn');

			corsPlugin({ cors: createDefaultCorsConfig() }, mockEnv, mockLogger);

			expect(warnSpy).not.toHaveBeenCalled();
		});

		it('should not throw when logger is not provided', () => {
			process.env.NODE_ENV = 'production';
			const mockEnv = createMockEnv('production');

			expect(() =>
				corsPlugin({ cors: createDefaultCorsConfig() }, mockEnv),
			).not.toThrow();
		});
	});

	describe('environment-based defaults', () => {
		it('should create plugin in development mode', () => {
			process.env.NODE_ENV = 'development';
			const mockEnv = createMockEnv('development');

			const plugin = corsPlugin(
				{ cors: createDefaultCorsConfig() },
				mockEnv,
				createMockLogger(),
			);

			expect(plugin).toBeDefined();
		});

		it('should create plugin in production mode', () => {
			process.env.NODE_ENV = 'production';
			const mockEnv = createMockEnv('production');

			const plugin = corsPlugin(
				{ cors: createDefaultCorsConfig() },
				mockEnv,
				createMockLogger(),
			);

			expect(plugin).toBeDefined();
		});
	});

	describe('configuration handling', () => {
		it('should accept custom origin configuration', () => {
			process.env.NODE_ENV = 'production';
			const mockEnv = createMockEnv('production');

			const plugin = corsPlugin(
				{
					cors: { ...createDefaultCorsConfig(), origin: ['https://myapp.com'] },
				},
				mockEnv,
				createMockLogger(),
			);

			expect(plugin).toBeDefined();
		});

		it('should accept custom methods configuration', () => {
			process.env.NODE_ENV = 'production';
			const mockEnv = createMockEnv('production');

			const plugin = corsPlugin(
				{
					cors: {
						...createDefaultCorsConfig(),
						methods: ['GET', 'POST'],
					},
				},
				mockEnv,
				createMockLogger(),
			);

			expect(plugin).toBeDefined();
		});

		it('should accept custom allowedHeaders configuration', () => {
			process.env.NODE_ENV = 'production';
			const mockEnv = createMockEnv('production');

			const plugin = corsPlugin(
				{
					cors: {
						...createDefaultCorsConfig(),
						allowedHeaders: ['X-Custom-Header'],
					},
				},
				mockEnv,
				createMockLogger(),
			);

			expect(plugin).toBeDefined();
		});

		it('should handle multiple CORS options together', () => {
			process.env.NODE_ENV = 'production';
			const mockEnv = createMockEnv('production');

			const plugin = corsPlugin(
				{
					cors: {
						origin: ['https://myapp.com'],
						methods: ['GET', 'POST'],
						allowedHeaders: ['X-Custom-Header', 'Authorization'],
					},
				},
				mockEnv,
				createMockLogger(),
			);

			expect(plugin).toBeDefined();
		});
	});
});
