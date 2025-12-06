import pino from 'pino';
import pretty from 'pino-pretty';

export interface LoggerOptions {
	name?: string;
	level?: pino.LevelWithSilent;
	env?: string;
}

export interface LoggerEnv {
	LOG_LEVEL?: string;
	NODE_ENV?: string;
	BUN_ENV?: string;
}

/**
 * Create a Pino logger instance configured for Glaze CMS
 *
 * In production: JSON logs for machine parsing
 * In development: Pretty-printed colorized logs
 *
 * @param options - Logger configuration options
 * @param env - Environment variables (defaults to Bun.env)
 */
export function createLogger(
	options: LoggerOptions = {},
	env: LoggerEnv = Bun.env,
) {
	const logLevel = (options.level ??
		env.LOG_LEVEL ??
		'info') as pino.LevelWithSilent;
	const nodeEnv = options.env ?? env.BUN_ENV ?? env.NODE_ENV ?? 'development';
	const isProduction = nodeEnv === 'production';

	const baseConfig: pino.LoggerOptions = {
		level: logLevel,
		name: options.name ?? 'glaze',
		// Add timestamp in production for log aggregation
		timestamp: isProduction ? pino.stdTimeFunctions.isoTime : undefined,
		// Redact sensitive data
		redact: {
			paths: ['*.password', '*.token', '*.apiKey', '*.secret', 'DATABASE_URL'],
			censor: '[REDACTED]',
		},
	};

	if (isProduction) {
		return pino(baseConfig);
	}

	// Development: pretty printing with colors
	const stream = pretty({
		colorize: true,
		translateTime: 'HH:MM:ss',
		ignore: 'pid,hostname',
		singleLine: false,
	}) as pino.DestinationStream;

	return pino(baseConfig, stream);
}

/**
 * Default logger instance for Glaze CMS
 * Can be imported directly for convenience: `import { logger } from '@glaze/logger'`
 */
export const logger = createLogger({ name: 'glaze' });

/**
 * Create a child logger with additional context
 * Useful for per-module or per-request logging
 *
 * @example
 * const convergeLogger = createChildLogger({ module: 'convergence' });
 * convergeLogger.info('Checking schema drift...');
 */
export function createChildLogger(bindings: pino.Bindings) {
	return logger.child(bindings);
}
