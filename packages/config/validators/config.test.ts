/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { createLogger } from '@glaze/logger';

import { validateConfig } from '.';
import type { GlazeConfig } from '../types';

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
			expect(mockProcessExit).not.toHaveBeenCalled();
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

	describe('rateLimit validation', () => {
		it('should allow valid rateLimit config', () => {
			const config = {
				schema: mockSchema,
				security: {
					rateLimit: {
						enabled: true,
						max: 100,
						duration: 60000,
					},
				},
			};

			const result = validateConfig(logger, config as GlazeConfig);

			expect(result.security?.rateLimit?.enabled).toBe(true);
			expect(result.security?.rateLimit?.max).toBe(100);
			expect(result.security?.rateLimit?.duration).toBe(60000);
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should allow partial rateLimit config', () => {
			const config = {
				schema: mockSchema,
				security: {
					rateLimit: {
						enabled: false,
					},
				},
			};

			const result = validateConfig(logger, config as GlazeConfig);

			expect(result.security?.rateLimit?.enabled).toBe(false);
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should reject negative max value', () => {
			const config = {
				schema: mockSchema,
				security: {
					rateLimit: {
						max: -1,
					},
				},
			};

			expect(() => {
				validateConfig(logger, config as GlazeConfig);
			}).toThrow('process.exit called');

			expect(mockProcessExit).toHaveBeenCalledWith(1);
		});

		it('should reject zero duration value', () => {
			const config = {
				schema: mockSchema,
				security: {
					rateLimit: {
						duration: 0,
					},
				},
			};

			expect(() => {
				validateConfig(logger, config as GlazeConfig);
			}).toThrow('process.exit called');

			expect(mockProcessExit).toHaveBeenCalledWith(1);
		});

		it('should reject unknown rateLimit properties', () => {
			const config = {
				schema: mockSchema,
				security: {
					rateLimit: {
						enabled: true,
						garbage: false,
					},
				},
			};

			expect(() => {
				validateConfig(logger, config as GlazeConfig);
			}).toThrow('process.exit called');

			expect(mockProcessExit).toHaveBeenCalledWith(1);
		});
	});

	describe('auth validation', () => {
		it('should allow auth.enabled: false', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				auth: {
					enabled: false,
				},
			};

			const result = validateConfig(logger, config);

			expect(result.auth?.enabled).toBe(false);
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should allow auth.enabled: true', () => {
			const config: GlazeConfig = {
				schema: mockSchema,
				auth: {
					enabled: true,
				},
			};

			const result = validateConfig(logger, config);

			expect(result.auth?.enabled).toBe(true);
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should allow auth with betterAuth.emailVerification', () => {
			const config = {
				schema: mockSchema,
				auth: {
					enabled: true as const,
					betterAuth: {
						emailVerification: {
							sendOnSignUp: true,
						},
					},
				},
			};

			const result = validateConfig(logger, config as GlazeConfig);

			expect(
				(result.auth as { betterAuth?: { emailVerification?: unknown } })
					.betterAuth?.emailVerification,
			).toEqual({
				sendOnSignUp: true,
			});
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should allow auth with betterAuth.emailAndPassword', () => {
			const config = {
				schema: mockSchema,
				auth: {
					enabled: true as const,
					betterAuth: {
						emailAndPassword: {
							requireEmailVerification: true,
						},
					},
				},
			};

			const result = validateConfig(logger, config as GlazeConfig);

			expect(
				(result.auth as { betterAuth?: { emailAndPassword?: unknown } })
					.betterAuth?.emailAndPassword,
			).toEqual({
				requireEmailVerification: true,
			});
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should allow auth with drizzleAdapter.debugLogs', () => {
			const config = {
				schema: mockSchema,
				auth: {
					enabled: true as const,
					drizzleAdapter: {
						debugLogs: true,
					},
				},
			};

			const result = validateConfig(logger, config as GlazeConfig);

			expect(
				(result.auth as { drizzleAdapter?: { debugLogs?: boolean } })
					.drizzleAdapter?.debugLogs,
			).toBe(true);
			expect(mockProcessExit).not.toHaveBeenCalled();
		});

		it('should reject unknown betterAuth properties', () => {
			const config = {
				schema: mockSchema,
				auth: {
					enabled: true,
					betterAuth: {
						database: 'some-db',
					},
				},
			};

			expect(() => {
				validateConfig(logger, config as GlazeConfig);
			}).toThrow('process.exit called');

			expect(mockProcessExit).toHaveBeenCalledWith(1);
		});

		it('should reject unknown drizzleAdapter properties', () => {
			const config = {
				schema: mockSchema,
				auth: {
					enabled: true,
					drizzleAdapter: {
						unknownProp: true,
					},
				},
			};

			expect(() => {
				validateConfig(logger, config as GlazeConfig);
			}).toThrow('process.exit called');

			expect(mockProcessExit).toHaveBeenCalledWith(1);
		});

		it('should reject auth.enabled: false with betterAuth options', () => {
			const config = {
				schema: mockSchema,
				auth: {
					enabled: false,
					betterAuth: {
						emailVerification: { sendOnSignUp: true },
					},
				},
			};

			expect(() => {
				validateConfig(logger, config as GlazeConfig);
			}).toThrow('process.exit called');

			expect(mockProcessExit).toHaveBeenCalledWith(1);
		});

		it('should allow complete auth config', () => {
			const config = {
				schema: mockSchema,
				auth: {
					enabled: true,
					betterAuth: {
						emailVerification: { sendOnSignUp: true },
						emailAndPassword: { requireEmailVerification: true },
					},
					drizzleAdapter: {
						debugLogs: true,
					},
					emailVerification: { sendOnSignUp: false },
					emailAndPassword: { minPasswordLength: 8 },
				},
			};

			const result = validateConfig(logger, config as GlazeConfig);
			const auth = result.auth;

			expect(auth).toBeDefined();
			if (auth && auth.enabled !== false) {
				expect(auth.betterAuth?.emailVerification).toEqual({
					sendOnSignUp: true,
				});
				expect(auth.drizzleAdapter?.debugLogs).toBe(true);
			}
			expect(mockProcessExit).not.toHaveBeenCalled();
		});
	});
});
