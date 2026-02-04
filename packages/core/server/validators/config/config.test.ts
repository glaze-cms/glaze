/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { createLogger } from '@glaze/logger';

import { validateConfig } from './config';
import type { GlazeConfig } from '../../config/types';
import {
	DEFAULT_CORS_METHODS,
	DEFAULT_CORS_ALLOWED_HEADERS,
} from '../../lib/consts';

const logger = createLogger({ name: 'TEST' });
const mockSchema = {};

describe('validateConfig', () => {
	let mockProcessExit: ReturnType<typeof mock>;
	let originalProcessExit: typeof process.exit;

	beforeEach(() => {
		originalProcessExit = process.exit;
		mockProcessExit = mock(() => {
			throw new Error('process.exit called');
		});
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		process.exit = mockProcessExit as any;
	});

	afterEach(() => {
		process.exit = originalProcessExit;
	});

	describe('Successful validation', () => {
		it('should return validated config with all fields provided', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				apiPrefix: '/api/v1',
				adminPrefix: '/dashboard',
				healthCheck: { enabled: true, path: '/healthz' },
			};

			const result = validateConfig(logger, config);

			expect(result.apiPrefix).toBe('/api/v1');
			expect(result.adminPrefix).toBe('/dashboard');
			expect(result.healthCheck.enabled).toBe(true);
			expect(result.healthCheck.path).toBe('/healthz');
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should apply default apiPrefix when not provided', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
			};

			const result = validateConfig(logger, config);

			expect(result.apiPrefix).toBe('/api');
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should apply default adminPrefix when not provided', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
			};

			const result = validateConfig(logger, config);

			expect(result.adminPrefix).toBe('/admin');
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should apply default healthCheck when not provided', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
			};

			const result = validateConfig(logger, config);

			expect(result.healthCheck.enabled).toBe(true);
			expect(result.healthCheck.path).toBe('/_health');
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should apply healthCheck defaults when partially provided', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				healthCheck: { enabled: false },
			};

			const result = validateConfig(logger, config);

			expect(result.healthCheck.enabled).toBe(false);
			expect(result.healthCheck.path).toBe('/_health'); // default
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should apply healthCheck path default when only path is omitted', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				healthCheck: { path: '/custom-health' },
			};

			const result = validateConfig(logger, config);

			expect(result.healthCheck.enabled).toBe(true); // default
			expect(result.healthCheck.path).toBe('/custom-health');
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should apply all defaults when no config is provided', () => {
			const result = validateConfig(logger);

			expect(result.apiPrefix).toBe('/api');
			expect(result.adminPrefix).toBe('/admin');
			expect(result.healthCheck.enabled).toBe(true);
			expect(result.healthCheck.path).toBe('/_health');
		});

		it('should apply default security.cors when not provided', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
			};

			const result = validateConfig(logger, config);

			expect(result.security.cors.methods).toEqual([...DEFAULT_CORS_METHODS]);
			expect(result.security.cors.allowedHeaders).toEqual([
				...DEFAULT_CORS_ALLOWED_HEADERS,
			]);
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should preserve other config fields', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				logger: {
					name: 'custom-logger',
				},
				security: { cors: { origin: '*' } },
			};

			const result = validateConfig(logger, config);

			expect(result.logger).toEqual({ name: 'custom-logger' });
			expect(result.security.cors.origin).toBe('*');
			expect(result.security.cors.methods).toEqual([...DEFAULT_CORS_METHODS]);
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should allow disabling healthCheck', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				healthCheck: { enabled: false },
			};

			const result = validateConfig(logger, config);

			expect(result.healthCheck.enabled).toBe(false);
			expect(result.healthCheck.path).toBe('/_health');
			expect(mockProcessExit).not.toHaveBeenCalled();
		});
	});

	describe('Validation errors', () => {
		it('should exit with code 1 when apiPrefix does not start with /', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				apiPrefix: 'api', // Missing leading slash
			};

			expect(() => {
				validateConfig(logger, config);
			}).toThrow('process.exit called');

			expect(mockProcessExit).toHaveBeenCalledWith(1);
		});

		it('should exit with code 1 when adminPrefix does not start with /', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				adminPrefix: 'admin', // Missing leading slash
			};

			expect(() => {
				validateConfig(logger, config);
			}).toThrow('process.exit called');

			expect(mockProcessExit).toHaveBeenCalledWith(1);
		});

		it('should exit with code 1 when adminPrefix is empty', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				adminPrefix: '',
			};

			expect(() => {
				validateConfig(logger, config);
			}).toThrow('process.exit called');

			expect(mockProcessExit).toHaveBeenCalledWith(1);
		});

		it('should exit with code 1 when apiPrefix is empty', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				apiPrefix: '',
			};

			expect(() => {
				validateConfig(logger, config);
			}).toThrow('process.exit called');

			expect(mockProcessExit).toHaveBeenCalledWith(1);
		});

		it('should exit with code 1 when healthCheck.path does not start with /', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				healthCheck: { path: 'health' }, // Missing leading slash
			};

			expect(() => {
				validateConfig(logger, config);
			}).toThrow('process.exit called');

			expect(mockProcessExit).toHaveBeenCalledWith(1);
		});

		it('should exit with code 1 when healthCheck.path is empty', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				healthCheck: { path: '' },
			};

			expect(() => {
				validateConfig(logger, config);
			}).toThrow('process.exit called');

			expect(mockProcessExit).toHaveBeenCalledWith(1);
		});
	});
});
