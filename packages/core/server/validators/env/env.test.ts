import { expect, test, describe, beforeEach, afterEach, mock } from 'bun:test';
import { parseEnv, validateEnv } from './env';
import { DEFAULT_SERVER_PORT } from '../../lib/consts/defaults';

describe('parseEnv', () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		// Save the original environment before each test
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		// Restore the original environment after each test
		process.env = originalEnv;
	});

	describe('Successful parsing', () => {
		test('should successfully parse when all required variables are present', () => {
			process.env = {
				GLAZE_DATABASE_URL: 'postgresql://localhost:5432/test',
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
				NODE_ENV: 'development',
			};

			const result = parseEnv();

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.env.GLAZE_DATABASE_URL).toBe(
					'postgresql://localhost:5432/test',
				);
				expect(result.env.GLAZE_AUTH_SECRET).toBe('a'.repeat(32));
				expect(result.env.NODE_ENV).toBe('development');
			}
		});

		test('should accept production NODE_ENV', () => {
			process.env = {
				GLAZE_DATABASE_URL: 'postgresql://localhost:5432/test',
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
				NODE_ENV: 'production',
			};

			const result = parseEnv();

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.env.NODE_ENV).toBe('production');
			}
		});

		test('should accept test NODE_ENV', () => {
			process.env = {
				GLAZE_DATABASE_URL: 'postgresql://localhost:5432/test',
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
				NODE_ENV: 'test',
			};

			const result = parseEnv();

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.env.NODE_ENV).toBe('test');
			}
		});
	});

	describe('Default handling', () => {
		test('should apply default for NODE_ENV when missing', () => {
			process.env = {
				GLAZE_DATABASE_URL: 'postgresql://localhost:5432/test',
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
			};

			const result = parseEnv();

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.env.NODE_ENV).toBe('development');
			}
		});

		test('should apply default for GLAZE_PORT when missing', () => {
			process.env = {
				GLAZE_DATABASE_URL: 'postgresql://localhost:5432/test',
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
			};

			const result = parseEnv();

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.env.GLAZE_PORT).toBe(DEFAULT_SERVER_PORT);
			}
		});

		test('should fallback to PORT when GLAZE_PORT is missing', () => {
			process.env = {
				GLAZE_DATABASE_URL: 'postgresql://localhost:5432/test',
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
				PORT: '8080',
			};

			const result = parseEnv();

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.env.GLAZE_PORT).toBe(8080);
			}
		});

		test('should prefer GLAZE_PORT over PORT when both are set', () => {
			process.env = {
				GLAZE_DATABASE_URL: 'postgresql://localhost:5432/test',
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
				GLAZE_PORT: '3000',
				PORT: '8080',
			};

			const result = parseEnv();

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.env.GLAZE_PORT).toBe(3000);
			}
		});

		test('should fallback to DATABASE_URL when GLAZE_DATABASE_URL is missing', () => {
			process.env = {
				DATABASE_URL: 'postgresql://railway:5432/db',
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
			};

			const result = parseEnv();

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.env.GLAZE_DATABASE_URL).toBe(
					'postgresql://railway:5432/db',
				);
			}
		});

		test('should prefer GLAZE_DATABASE_URL over DATABASE_URL when both are set', () => {
			process.env = {
				GLAZE_DATABASE_URL: 'postgresql://localhost:5432/test',
				DATABASE_URL: 'postgresql://railway:5432/db',
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
			};

			const result = parseEnv();

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.env.GLAZE_DATABASE_URL).toBe(
					'postgresql://localhost:5432/test',
				);
			}
		});
	});

	describe('Validation errors', () => {
		test('should fail when DATABASE_URL is missing', () => {
			process.env = {
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
				NODE_ENV: 'development',
			};

			const result = parseEnv();

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.errors.length).toBeGreaterThan(0);
				expect(result.errors[0]?.variable).toBe('GLAZE_DATABASE_URL');
				expect(result.errors[0]?.hint).toContain('GLAZE_DATABASE_URL');
			}
		});

		test('should fail when GLAZE_DATABASE_URL is empty string', () => {
			process.env = {
				GLAZE_DATABASE_URL: '',
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
				NODE_ENV: 'development',
			};

			const result = parseEnv();

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(
					result.errors.some((e) => e.variable === 'GLAZE_DATABASE_URL'),
				).toBe(true);
			}
		});

		test('should accept postgres:// URL scheme', () => {
			process.env = {
				GLAZE_DATABASE_URL: 'postgres://localhost:5432/test',
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
				NODE_ENV: 'development',
			};

			const result = parseEnv();

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.env.GLAZE_DATABASE_URL).toBe(
					'postgres://localhost:5432/test',
				);
			}
		});

		test('should accept postgresql:// URL scheme', () => {
			process.env = {
				GLAZE_DATABASE_URL: 'postgresql://localhost:5432/test',
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
				NODE_ENV: 'development',
			};

			const result = parseEnv();

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.env.GLAZE_DATABASE_URL).toBe(
					'postgresql://localhost:5432/test',
				);
			}
		});

		test('should reject MySQL database URLs', () => {
			process.env = {
				GLAZE_DATABASE_URL: 'mysql://localhost:3306/test',
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
				NODE_ENV: 'development',
			};

			const result = parseEnv();

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(
					result.errors.some((e) => e.variable === 'GLAZE_DATABASE_URL'),
				).toBe(true);
				const dbError = result.errors.find(
					(e) => e.variable === 'GLAZE_DATABASE_URL',
				);
				// TypeBox 1.0 generates this standard pattern error message
				expect(dbError?.message).toContain(
					'must match pattern "^(postgres|postgresql)://"',
				);
			}
		});

		test('should reject MongoDB database URLs', () => {
			process.env = {
				GLAZE_DATABASE_URL: 'mongodb://localhost:27017/test',
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
				NODE_ENV: 'development',
			};

			const result = parseEnv();

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(
					result.errors.some((e) => e.variable === 'GLAZE_DATABASE_URL'),
				).toBe(true);
			}
		});

		test('should reject SQLite database URLs', () => {
			process.env = {
				GLAZE_DATABASE_URL: 'sqlite://./test.db',
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
				NODE_ENV: 'development',
			};

			const result = parseEnv();

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(
					result.errors.some((e) => e.variable === 'GLAZE_DATABASE_URL'),
				).toBe(true);
			}
		});

		test('should fail when AUTH_SECRET is missing', () => {
			process.env = {
				GLAZE_DATABASE_URL: 'postgresql://localhost:5432/test',
				NODE_ENV: 'development',
			};

			const result = parseEnv();

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.errors[0]?.variable).toBe('GLAZE_AUTH_SECRET');
				expect(result.errors[0]?.hint).toContain('GLAZE_AUTH_SECRET');
			}
		});

		test('should fail when GLAZE_AUTH_SECRET is too short', () => {
			process.env = {
				GLAZE_DATABASE_URL: 'postgresql://localhost:5432/test',
				GLAZE_AUTH_SECRET: 'short',
				NODE_ENV: 'development',
			};

			const result = parseEnv();

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(
					result.errors.some((e) => e.variable === 'GLAZE_AUTH_SECRET'),
				).toBe(true);
			}
		});

		test('should fail when NODE_ENV is invalid', () => {
			process.env = {
				GLAZE_DATABASE_URL: 'postgresql://localhost:5432/test',
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
				NODE_ENV: 'invalid',
			};

			const result = parseEnv();

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.errors.some((e) => e.variable === 'NODE_ENV')).toBe(true);
			}
		});

		test('should return multiple errors when multiple variables are invalid', () => {
			process.env = {
				// Missing GLAZE_DATABASE_URL and GLAZE_AUTH_SECRET
				NODE_ENV: 'invalid',
			};

			const result = parseEnv();

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.errors.length).toBeGreaterThanOrEqual(2);
			}
		});
	});

	describe('Error message formatting', () => {
		test('should format error messages with variable name, message, and hint', () => {
			process.env = {
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
				// Missing GLAZE_DATABASE_URL
			};

			const result = parseEnv();

			expect(result.success).toBe(false);
			if (!result.success && result.errors.length > 0) {
				const error = result.errors[0];
				expect(error).toHaveProperty('variable');
				expect(error).toHaveProperty('message');
				expect(error).toHaveProperty('hint');
				expect(error?.variable).toBe('GLAZE_DATABASE_URL');
				expect(error?.hint).toContain('.env');
			}
		});

		test('should include custom error messages from schema', () => {
			process.env = {
				GLAZE_DATABASE_URL: '',
				GLAZE_AUTH_SECRET: 'a'.repeat(32),
			};

			const result = parseEnv();

			expect(result.success).toBe(false);
			if (!result.success) {
				const dbError = result.errors.find(
					(e) => e.variable === 'GLAZE_DATABASE_URL',
				);
				expect(dbError?.message).toBeDefined();
			}
		});
	});
});

describe('validateEnv', () => {
	let originalEnv: NodeJS.ProcessEnv;
	let mockProcessExit: ReturnType<typeof mock>;
	let originalProcessExit: typeof process.exit;
	let mockLogger: {
		error: ReturnType<typeof mock>;
		info: ReturnType<typeof mock>;
	};

	beforeEach(() => {
		originalEnv = { ...process.env };
		// Save the original environment before each test
		// eslint-disable-next-line @typescript-eslint/unbound-method
		originalProcessExit = process.exit;
		mockProcessExit = mock(() => {
			throw new Error('process.exit called');
		});
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		process.exit = mockProcessExit as any;

		// Create mock logger (only mocking methods used in tests)
		mockLogger = {
			error: mock(() => {}),
			info: mock(() => {}),
		};
	});

	afterEach(() => {
		process.env = originalEnv;
		// Restore process.exit
		process.exit = originalProcessExit;
	});

	test('should return env when validation succeeds', () => {
		process.env = {
			GLAZE_DATABASE_URL: 'postgres://localhost/test',
			GLAZE_AUTH_SECRET: 'a'.repeat(32),
			NODE_ENV: 'test',
		};

		// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
		const env = validateEnv(mockLogger as any);

		expect(env.GLAZE_DATABASE_URL).toBe('postgres://localhost/test');
		expect(env.GLAZE_AUTH_SECRET).toBe('a'.repeat(32));
		expect(env.NODE_ENV).toBe('test');
		expect(mockProcessExit).not.toHaveBeenCalled();
		expect(mockLogger.error).not.toHaveBeenCalled();
	});

	test('should exit with code 1 when validation fails', () => {
		process.env = {
			// Missing GLAZE_DATABASE_URL and GLAZE_AUTH_SECRET
			NODE_ENV: 'development',
		};

		expect(() => {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
			validateEnv(mockLogger as any);
		}).toThrow('process.exit called');

		expect(mockProcessExit).toHaveBeenCalledWith(1);
		expect(mockLogger.error).toHaveBeenCalled();
	});

	test('should log all errors via logger when validation fails', () => {
		process.env = {
			// Missing GLAZE_DATABASE_URL and GLAZE_AUTH_SECRET
			NODE_ENV: 'development',
		};

		expect(() => {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
			validateEnv(mockLogger as any);
		}).toThrow('process.exit called');

		// Should log the main error message
		expect(mockLogger.error).toHaveBeenCalledWith(
			'Environment validation failed',
		);

		// Should log individual variable errors
		const errorCalls = mockLogger.error.mock.calls;
		expect(errorCalls.length).toBeGreaterThan(1);

		// Should log hints via info
		const infoCalls = mockLogger.info.mock.calls;
		expect(infoCalls.length).toBeGreaterThan(0);
	});
});
