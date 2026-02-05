/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { createLogger } from '@glaze/logger';

import { validateConfig } from './config';
import type { GlazeConfig } from '../../config/types';

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

			// Should return original config (no defaults applied in validation)
			expect(result.apiPrefix).toBe('/api/v1');
			expect(result.adminPrefix).toBe('/dashboard');
			expect(result.healthCheck?.enabled).toBe(true);
			expect(result.healthCheck?.path).toBe('/healthz');
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should allow undefined optional fields', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
			};

			const result = validateConfig(logger, config);

			// Optional fields should remain undefined (defaults applied later by resolver)
			expect(result.apiPrefix).toBeUndefined();
			expect(result.adminPrefix).toBeUndefined();
			expect(result.healthCheck).toBeUndefined();
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should return minimal config when no config provided', () => {
			const result = validateConfig(logger);

			// Should return minimal valid config with just schema
			expect(result.schema).toEqual({});
			expect(result.apiPrefix).toBeUndefined();
			expect(result.adminPrefix).toBeUndefined();
			expect(result.healthCheck).toBeUndefined();
		});

		it('should preserve all user-provided fields', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				logger: {
					name: 'custom-logger',
				},
				security: { cors: { origin: '*' } },
			};

			const result = validateConfig(logger, config);

			expect(result.logger).toEqual({ name: 'custom-logger' });
			expect(result.security).toEqual({ cors: { origin: '*' } });
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should allow partial healthCheck config', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				healthCheck: { enabled: false },
			};

			const result = validateConfig(logger, config);

			expect(result.healthCheck?.enabled).toBe(false);
			expect(result.healthCheck?.path).toBeUndefined(); // Not defaulted yet
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should allow partial security.cors config', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				security: { cors: { origin: '*' } },
			};

			const result = validateConfig(logger, config);

			expect(result.security?.cors?.origin).toBe('*');
			expect(result.security?.cors?.methods).toBeUndefined(); // Not defaulted yet
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
