import { describe, expect, it, spyOn } from 'bun:test';
import type { Logger } from '@glaze/logger';
import type { GlazeEnv } from '@glaze/config';
import {
	DEFAULT_CORS_METHODS,
	DEFAULT_CORS_ALLOWED_HEADERS,
} from '@glaze/config';
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

const createDefaultSecurityConfig = (corsOverrides?: {
	origin?: string[];
	methods?: string[];
	allowedHeaders?: string[];
}) => ({
	cors: { ...createDefaultCorsConfig(), ...corsOverrides },
	rateLimit: { enabled: true, max: 60, duration: 60000 },
});

describe('corsPlugin', () => {
	describe('production warning', () => {
		it('should warn when no origins configured in production', () => {
			const mockLogger = createMockLogger();
			const mockEnv = createMockEnv('production');
			const warnSpy = spyOn(mockLogger, 'warn');

			corsPlugin(createDefaultSecurityConfig(), mockEnv, mockLogger);

			expect(warnSpy).toHaveBeenCalledWith(
				'No CORS origins configured in production. All cross-origin requests will be blocked.',
			);
		});

		it('should not warn when origins are configured in production', () => {
			const mockLogger = createMockLogger();
			const mockEnv = createMockEnv('production');
			const warnSpy = spyOn(mockLogger, 'warn');

			corsPlugin(
				createDefaultSecurityConfig({ origin: ['https://myapp.com'] }),
				mockEnv,
				mockLogger,
			);

			expect(warnSpy).not.toHaveBeenCalled();
		});

		it('should not warn in development mode', () => {
			const mockLogger = createMockLogger();
			const mockEnv = createMockEnv('development');
			const warnSpy = spyOn(mockLogger, 'warn');

			corsPlugin(createDefaultSecurityConfig(), mockEnv, mockLogger);

			expect(warnSpy).not.toHaveBeenCalled();
		});

		it('should not throw when logger is not provided', () => {
			const mockEnv = createMockEnv('production');

			expect(() =>
				corsPlugin(createDefaultSecurityConfig(), mockEnv),
			).not.toThrow();
		});
	});

	describe('environment-based defaults', () => {
		it('should create plugin in development mode', () => {
			const mockEnv = createMockEnv('development');

			const plugin = corsPlugin(
				createDefaultSecurityConfig(),
				mockEnv,
				createMockLogger(),
			);

			expect(plugin).toBeDefined();
		});

		it('should create plugin in production mode', () => {
			const mockEnv = createMockEnv('production');

			const plugin = corsPlugin(
				createDefaultSecurityConfig(),
				mockEnv,
				createMockLogger(),
			);

			expect(plugin).toBeDefined();
		});
	});

	describe('configuration handling', () => {
		it('should accept custom origin configuration', () => {
			const mockEnv = createMockEnv('production');

			const plugin = corsPlugin(
				createDefaultSecurityConfig({ origin: ['https://myapp.com'] }),
				mockEnv,
				createMockLogger(),
			);

			expect(plugin).toBeDefined();
		});

		it('should accept custom methods configuration', () => {
			const mockEnv = createMockEnv('production');

			const plugin = corsPlugin(
				createDefaultSecurityConfig({ methods: ['GET', 'POST'] }),
				mockEnv,
				createMockLogger(),
			);

			expect(plugin).toBeDefined();
		});

		it('should accept custom allowedHeaders configuration', () => {
			const mockEnv = createMockEnv('production');

			const plugin = corsPlugin(
				createDefaultSecurityConfig({ allowedHeaders: ['X-Custom-Header'] }),
				mockEnv,
				createMockLogger(),
			);

			expect(plugin).toBeDefined();
		});

		it('should handle multiple CORS options together', () => {
			const mockEnv = createMockEnv('production');

			const plugin = corsPlugin(
				createDefaultSecurityConfig({
					origin: ['https://myapp.com'],
					methods: ['GET', 'POST'],
					allowedHeaders: ['X-Custom-Header', 'Authorization'],
				}),
				mockEnv,
				createMockLogger(),
			);

			expect(plugin).toBeDefined();
		});
	});
});
