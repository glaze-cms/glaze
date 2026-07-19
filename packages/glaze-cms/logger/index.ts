import pino from 'pino';
import pretty from 'pino-pretty';

import { getColoredName, getColoredLevel } from './utils.ts';

/** Configuration for a Glaze logger. */
export interface LoggerOptions {
	/**
	 * The name of the logger, included in every log line.
	 * @default 'GLAZE'
	 */
	name?: string;
	/**
	 * The minimum level of logs to display.
	 * @default 'info'
	 */
	level?: pino.LevelWithSilent;
	/**
	 * Additional object keys to redact from logs, merged with the default Glaze list.
	 */
	redact?: string[];
}

/** The subset of environment variables the logger reads. */
export interface LoggerEnv {
	LOG_LEVEL?: string;
	NODE_ENV?: string;
	BUN_ENV?: string;
}

const { isoTime } = pino.stdTimeFunctions;

/** Sensitive keys always redacted, regardless of user configuration. */
const DEFAULT_REDACT_PATHS = ['*.password', '*.token', '*.apiKey', '*.secret', 'DATABASE_URL'];

/** Fallback logger name when none is provided. */
const DEFAULT_LOGGER_NAME = 'GLAZE';

/** Levels pino recognizes; anything else falls back to `info`. */
const VALID_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

/**
 * Creates a Pino logger with Glaze defaults.
 *
 * In production (`BUN_ENV`/`NODE_ENV` === 'production') it emits structured JSON; otherwise it
 * pretty-prints with colored name badges. Sensitive keys are always redacted. The `env` default
 * is cross-runtime `process.env` so the logger works identically on Bun and Node.
 *
 * @param options - Logger configuration (name, level, extra redaction paths).
 * @param env - Environment variables to read; defaults to `process.env`.
 * @returns A configured Pino logger instance.
 *
 * @example
 * ```ts
 * const logger = createLogger({ name: 'api', level: 'debug' });
 * logger.info('ready');
 * ```
 */
export function createLogger(
	options: LoggerOptions = {},
	env: LoggerEnv = process.env,
): pino.Logger {
	const requestedLevel = (options.level ?? env.LOG_LEVEL ?? 'info').toLowerCase();
	const logLevel = (
		VALID_LEVELS.has(requestedLevel) ? requestedLevel : 'info'
	) as pino.LevelWithSilent;

	const isProduction = (env.BUN_ENV ?? env.NODE_ENV) === 'production';

	const mergedRedact = Array.from(new Set([...DEFAULT_REDACT_PATHS, ...(options.redact ?? [])]));

	const baseConfig: pino.LoggerOptions = {
		level: logLevel,
		name: options.name ?? DEFAULT_LOGGER_NAME,
		timestamp: isoTime,
		formatters: {
			level: (label) => ({ level: label }),
		},
		redact: {
			paths: mergedRedact,
			censor: '[REDACTED]',
		},
	};

	if (isProduction) return pino(baseConfig);

	return pino(
		baseConfig,
		pretty({
			colorize: false,
			translateTime: 'HH:MM:ss',
			ignore: 'pid,hostname,name,level',
			sync: true,
			messageFormat: (log, messageKey) => {
				const name = (log as { name?: string }).name ?? DEFAULT_LOGGER_NAME;
				const level = (log as { level?: string }).level ?? 'info';
				const message = log[messageKey] as string;
				return `${getColoredName(name)} ${getColoredLevel(level)}: ${message}`;
			},
		}),
	);
}

/** A configured Glaze logger. */
export type Logger = pino.Logger;
