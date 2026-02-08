import { expect, test, describe, spyOn } from 'bun:test';
import { createLogger } from './index';

const captureStdout = (fn: () => void): string => {
	const writes: string[] = [];
	const writeSpy = spyOn(process.stdout, 'write').mockImplementation(
		(chunk: unknown) => {
			writes.push(String(chunk));
			return true;
		},
	);

	try {
		fn();
	} finally {
		writeSpy.mockRestore();
	}

	return writes.join('');
};

describe('Logger', () => {
	test('should handle uppercase log levels (e.g., DEBUG)', () => {
		const logger = createLogger({}, { LOG_LEVEL: 'DEBUG' });
		expect(logger.level).toBe('debug');
	});

	test("should fall back to 'info' if an invalid level is provided", () => {
		const logger = createLogger({}, { LOG_LEVEL: 'invalid' });
		expect(logger.level).toBe('info');
	});

	test('should prefer options.level over env.LOG_LEVEL', () => {
		const logger = createLogger({ level: 'error' }, { LOG_LEVEL: 'debug' });
		expect(logger.level).toBe('error');
	});

	test('should use the provided name in base config', () => {
		const logger = createLogger({ name: 'test-app' });
		expect(logger.bindings().name).toBe('test-app');
	});

	describe('Environment-based behavior', () => {
		test('should use JSON output in production with NODE_ENV', () => {
			const output = captureStdout(() => {
				const logger = createLogger({}, { NODE_ENV: 'production' });
				logger.info('test message');
			});

			// In production, the output should be valid JSON
			const parsed = JSON.parse(output) as {
				level: string;
				msg: string;
				name: string;
			};
			// Our custom formatter outputs level as a string, not a number
			expect(parsed.level).toBe('info');
			expect(parsed.msg).toBe('test message');
			expect(parsed.name).toBe('GLAZE');
		});

		test('should use JSON output in production with BUN_ENV', () => {
			const output = captureStdout(() => {
				const logger = createLogger({}, { BUN_ENV: 'production' });
				logger.info('test message');
			});

			// BUN_ENV should work the same as NODE_ENV
			const parsed = JSON.parse(output) as {
				level: string;
				msg: string;
				name: string;
			};
			expect(parsed.level).toBe('info');
			expect(parsed.msg).toBe('test message');
			expect(parsed.name).toBe('GLAZE');
		});

		test('should prefer BUN_ENV over NODE_ENV when both are set', () => {
			// When BUN_ENV is production and NODE_ENV is development,
			// should use production mode (JSON output)
			const output = captureStdout(() => {
				const logger = createLogger(
					{},
					{ BUN_ENV: 'production', NODE_ENV: 'development' },
				);
				logger.info('test');
			});

			const parsed = JSON.parse(output) as {
				level: string;
				name: string;
			};
			expect(parsed.level).toBe('info');
			expect(parsed.name).toBe('GLAZE');
		});

		test('should use development mode when NODE_ENV is development', () => {
			const logger = createLogger({}, { NODE_ENV: 'development' });

			// In development mode, the logger should have the correct bindings
			expect(logger.level).toBe('info');
			expect(logger.bindings().name).toBe('GLAZE');
		});

		test('should use development mode when environment is not specified', () => {
			const logger = createLogger({}, {});

			// Should default to development mode
			expect(logger.level).toBe('info');
			expect(logger.bindings().name).toBe('GLAZE');
		});

		test('should create logger with production config when NODE_ENV is production', () => {
			const prodLogger = createLogger({}, { NODE_ENV: 'production' });
			const devLogger = createLogger({}, { NODE_ENV: 'development' });

			// Both should have the same basic properties
			expect(prodLogger.level).toBe('info');
			expect(devLogger.level).toBe('info');

			// Both should have correct bindings
			expect(prodLogger.bindings().name).toBe('GLAZE');
			expect(devLogger.bindings().name).toBe('GLAZE');
		});
	});

	describe('Redaction', () => {
		test('should merge custom redact paths with defaults', () => {
			const logger = createLogger({ redact: ['custom.field'] });

			// We can't directly inspect the redact config, but we can verify
			// the logger was created successfully with the custom redact paths
			expect(logger.bindings().name).toBe('GLAZE');
		});

		test('should redact password fields in production output', () => {
			const output = captureStdout(() => {
				const logger = createLogger({}, { NODE_ENV: 'production' });
				logger.info({ user: { password: 'super-secret-123' } }, 'user login');
			});

			expect(output).toContain('[REDACTED]');
			expect(output).not.toContain('super-secret-123');
		});

		test('should redact token fields in production output', () => {
			const output = captureStdout(() => {
				const logger = createLogger({}, { NODE_ENV: 'production' });
				logger.info({ auth: { token: 'jwt-token-value' } }, 'auth event');
			});

			expect(output).toContain('[REDACTED]');
			expect(output).not.toContain('jwt-token-value');
		});

		test('should redact apiKey fields in production output', () => {
			const output = captureStdout(() => {
				const logger = createLogger({}, { NODE_ENV: 'production' });
				logger.info({ service: { apiKey: 'sk-12345' } }, 'api call');
			});

			expect(output).toContain('[REDACTED]');
			expect(output).not.toContain('sk-12345');
		});

		test('should redact secret fields in production output', () => {
			const output = captureStdout(() => {
				const logger = createLogger({}, { NODE_ENV: 'production' });
				logger.info({ config: { secret: 'my-secret-value' } }, 'config loaded');
			});

			expect(output).toContain('[REDACTED]');
			expect(output).not.toContain('my-secret-value');
		});

		test('should redact DATABASE_URL in production output', () => {
			const output = captureStdout(() => {
				const logger = createLogger({}, { NODE_ENV: 'production' });
				logger.info(
					{ DATABASE_URL: 'postgres://user:pass@host:5432/db' },
					'env loaded',
				);
			});

			expect(output).toContain('[REDACTED]');
			expect(output).not.toContain('postgres://user:pass@host:5432/db');
		});

		test('should redact custom paths when provided', () => {
			const output = captureStdout(() => {
				const logger = createLogger(
					{ redact: ['customSecret'] },
					{ NODE_ENV: 'production' },
				);
				logger.info({ customSecret: 'should-be-hidden' }, 'custom data');
			});

			expect(output).toContain('[REDACTED]');
			expect(output).not.toContain('should-be-hidden');
		});

		test('should not redact non-sensitive fields', () => {
			const output = captureStdout(() => {
				const logger = createLogger({}, { NODE_ENV: 'production' });
				logger.info(
					{ username: 'john', email: 'john@example.com' },
					'user data',
				);
			});

			expect(output).toContain('john');
			expect(output).toContain('john@example.com');
		});
	});
});
