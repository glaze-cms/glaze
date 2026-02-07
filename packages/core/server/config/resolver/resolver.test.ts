import { describe, it, expect } from 'bun:test';
import { resolveConfig } from './resolver';
import { authResolver } from './auth';
import type { GlazeConfig } from '../types';
import type { AuthConfig } from '../types/auth';
import {
	DEFAULT_API_PREFIX,
	DEFAULT_ADMIN_PREFIX,
	DEFAULT_HEALTH_CHECK_PATH,
	DEFAULT_CORS_METHODS,
	DEFAULT_CORS_ALLOWED_HEADERS,
} from '../../lib/consts';

const mockSchema = {};

describe('resolveConfig', () => {
	describe('applying defaults', () => {
		it('should apply default apiPrefix when not provided', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
			};

			const result = resolveConfig(config);

			expect(result.apiPrefix).toBe(DEFAULT_API_PREFIX);
		});

		it('should apply default adminPrefix when not provided', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
			};

			const result = resolveConfig(config);

			expect(result.adminPrefix).toBe(DEFAULT_ADMIN_PREFIX);
		});

		it('should apply default healthCheck when not provided', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
			};

			const result = resolveConfig(config);

			expect(result.healthCheck.enabled).toBe(true);
			expect(result.healthCheck.path).toBe(DEFAULT_HEALTH_CHECK_PATH);
		});

		it('should apply healthCheck defaults when partially provided', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				healthCheck: { enabled: false },
			};

			const result = resolveConfig(config);

			expect(result.healthCheck.enabled).toBe(false);
			expect(result.healthCheck.path).toBe(DEFAULT_HEALTH_CHECK_PATH);
		});

		it('should apply healthCheck path default when only path is omitted', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				healthCheck: { path: '/custom-health' },
			};

			const result = resolveConfig(config);

			expect(result.healthCheck.enabled).toBe(true);
			expect(result.healthCheck.path).toBe('/custom-health');
		});

		it('should apply default security.cors when not provided', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
			};

			const result = resolveConfig(config);

			expect(result.security.cors.methods).toEqual([...DEFAULT_CORS_METHODS]);
			expect(result.security.cors.allowedHeaders).toEqual([
				...DEFAULT_CORS_ALLOWED_HEADERS,
			]);
		});

		it('should apply all defaults for minimal config', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
			};

			const result = resolveConfig(config);

			expect(result.apiPrefix).toBe(DEFAULT_API_PREFIX);
			expect(result.adminPrefix).toBe(DEFAULT_ADMIN_PREFIX);
			expect(result.healthCheck.enabled).toBe(true);
			expect(result.healthCheck.path).toBe(DEFAULT_HEALTH_CHECK_PATH);
			expect(result.security.cors.methods).toEqual([...DEFAULT_CORS_METHODS]);
			expect(result.security.cors.allowedHeaders).toEqual([
				...DEFAULT_CORS_ALLOWED_HEADERS,
			]);
		});
	});

	describe('preserving user values', () => {
		it('should preserve user-provided apiPrefix', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				apiPrefix: '/api/v1',
			};

			const result = resolveConfig(config);

			expect(result.apiPrefix).toBe('/api/v1');
		});

		it('should preserve user-provided adminPrefix', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				adminPrefix: '/dashboard',
			};

			const result = resolveConfig(config);

			expect(result.adminPrefix).toBe('/dashboard');
		});

		it('should preserve user-provided healthCheck values', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				healthCheck: { enabled: false, path: '/healthz' },
			};

			const result = resolveConfig(config);

			expect(result.healthCheck.enabled).toBe(false);
			expect(result.healthCheck.path).toBe('/healthz');
		});

		it('should preserve user-provided CORS origin', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				security: { cors: { origin: ['https://myapp.com'] } },
			};

			const result = resolveConfig(config);

			expect(result.security.cors.origin).toEqual(['https://myapp.com']);
			expect(result.security.cors.methods).toEqual([...DEFAULT_CORS_METHODS]);
		});

		it('should preserve user-provided CORS methods', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				security: { cors: { methods: ['GET', 'POST'] } },
			};

			const result = resolveConfig(config);

			expect(result.security.cors.methods).toEqual(['GET', 'POST']);
			expect(result.security.cors.allowedHeaders).toEqual([
				...DEFAULT_CORS_ALLOWED_HEADERS,
			]);
		});

		it('should preserve user-provided CORS allowedHeaders', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				security: { cors: { allowedHeaders: ['X-Custom'] } },
			};

			const result = resolveConfig(config);

			expect(result.security.cors.allowedHeaders).toEqual(['X-Custom']);
			expect(result.security.cors.methods).toEqual([...DEFAULT_CORS_METHODS]);
		});

		it('should preserve other config fields like logger', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				logger: { name: 'custom-logger' },
			};

			const result = resolveConfig(config);

			expect(result.logger).toEqual({ name: 'custom-logger' });
		});
	});

	describe('deep merging', () => {
		it('should deeply merge nested objects', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				security: {
					cors: {
						origin: ['https://myapp.com'],
						// methods and allowedHeaders should get defaults
					},
				},
			};

			const result = resolveConfig(config);

			expect(result.security.cors.origin).toEqual(['https://myapp.com']);
			expect(result.security.cors.methods).toEqual([...DEFAULT_CORS_METHODS]);
			expect(result.security.cors.allowedHeaders).toEqual([
				...DEFAULT_CORS_ALLOWED_HEADERS,
			]);
		});

		it('should replace arrays completely (not merge)', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				security: { cors: { methods: ['GET'] } },
			};

			const result = resolveConfig(config);

			// User array should replace default array
			expect(result.security.cors.methods).toEqual(['GET']);
			expect(result.security.cors.methods).not.toEqual([
				...DEFAULT_CORS_METHODS,
			]);
		});
	});

	describe('path validation', () => {
		it('should throw error when apiPrefix does not start with "/"', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				apiPrefix: 'api', // Missing leading slash
			};

			expect(() => resolveConfig(config)).toThrow(
				'apiPrefix must start with "/"',
			);
		});

		it('should throw error when adminPrefix does not start with "/"', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				adminPrefix: 'admin', // Missing leading slash
			};

			expect(() => resolveConfig(config)).toThrow(
				'adminPrefix must start with "/"',
			);
		});

		it('should remove trailing slashes from apiPrefix', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				apiPrefix: '/api/',
			};

			const result = resolveConfig(config);

			expect(result.apiPrefix).toBe('/api');
		});

		it('should remove multiple trailing slashes from apiPrefix', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				apiPrefix: '/api///',
			};

			const result = resolveConfig(config);

			expect(result.apiPrefix).toBe('/api');
		});

		it('should remove trailing slashes from adminPrefix', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				adminPrefix: '/admin/',
			};

			const result = resolveConfig(config);

			expect(result.adminPrefix).toBe('/admin');
		});
	});

	describe('auth resolver', () => {
		it('should create correct basePath from apiPrefix', () => {
			const result = authResolver('/api', undefined);

			expect(result.basePath).toBe('/api/auth');
		});

		it('should create correct basePath with trailing slash removed from apiPrefix', () => {
			const result = authResolver('/api/', undefined);

			expect(result.basePath).toBe('/api/auth');
		});

		it('should have publicAuthEnabled true by default', () => {
			const result = authResolver('/api', undefined);

			expect(result.publicAuthEnabled).toBe(true);
		});

		it('should set publicAuthEnabled to false when auth is disabled', () => {
			const authConfig: AuthConfig = { enabled: false };
			const result = authResolver('/api', authConfig);

			expect(result.publicAuthEnabled).toBe(false);
		});

		it('should have default appName', () => {
			const result = authResolver('/api', undefined);

			expect(result.appName).toBe('Glaze CMS');
		});

		it('should have emailAndPassword enabled by default', () => {
			const result = authResolver('/api', undefined);

			expect(result.emailAndPassword?.enabled).toBe(true);
		});

		it('should merge user emailAndPassword config when auth is enabled', () => {
			const customConfig = { requireEmailVerification: true };
			const authConfig = {
				enabled: true as const,
				emailAndPassword: customConfig,
			};
			const result = authResolver('/api', authConfig);

			expect(result.emailAndPassword).toMatchObject({
				enabled: true,
				requireEmailVerification: true,
			});
		});

		it('should not include emailAndPassword options when auth is disabled', () => {
			const authConfig: AuthConfig = {
				enabled: false,
			};
			const result = authResolver('/api', authConfig);

			// Only enabled: true is set, no user options are merged
			expect(result.emailAndPassword).toEqual({ enabled: true });
		});

		it('should pass through emailVerification when auth is enabled', () => {
			const authConfig: AuthConfig = {
				enabled: true,
				emailVerification: {
					sendOnSignUp: true,
				},
			};
			const result = authResolver('/api', authConfig);

			expect(result.emailVerification).toEqual({ sendOnSignUp: true });
		});

		it('should not include emailVerification when auth is not configured', () => {
			const result = authResolver('/api', undefined);

			expect(result.emailVerification).toBeUndefined();
		});
	});
});
