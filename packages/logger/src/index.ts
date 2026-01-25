import pino from 'pino';
import pretty from 'pino-pretty';

/* Utils */
import { getColoredName, getColoredLevel } from './utils';

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
	 * Additional object keys to redact from logs.
	 * These are merged with the default Glaze redaction list.
	 */
	redact?: string[];
}

export interface LoggerEnv {
	LOG_LEVEL?: string;
	NODE_ENV?: string;
	BUN_ENV?: string;
}

const { isoTime } = pino.stdTimeFunctions;

/**
 * Default sensitive keys that should always be redacted
 */
const DEFAULT_REDACT_PATHS = [
	'*.password',
	'*.token',
	'*.apiKey',
	'*.secret',
	'DATABASE_URL',
];

/**
 * Default logger name
 */
const DEFAULT_LOGGER_NAME = 'GLAZE';

/**
 * Creates a Pino logger instance with Glaze-specific configuration.
 *
 * In production (when `BUN_ENV` or `NODE_ENV` is 'production'), outputs structured JSON logs.
 * In development, uses pretty-printed colored output with logger name badges.
 *
 * @param options - Logger configuration options
 * @param env - Environment variables (defaults to Bun.env)
 * @returns A configured Pino logger instance
 *
 * @example
 * ```typescript
 * // Create a logger with default settings
 * const logger = createLogger();
 * logger.info('Hello world');
 *
 * // Create a logger with custom name and level
 * const apiLogger = createLogger({ name: 'api', level: 'debug' });
 * apiLogger.debug('API request received');
 * ```
 */
export function createLogger(
	options: LoggerOptions = {},
	env: LoggerEnv = Bun.env,
) {
	const rawLevel = (options.level ?? env.LOG_LEVEL ?? 'info').toLowerCase();
	const logLevel = (
		['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(
			rawLevel,
		)
			? rawLevel
			: 'info'
	) as pino.LevelWithSilent;

	const isProduction = (env.BUN_ENV ?? env.NODE_ENV) === 'production';

	// Manually merge default and user redaction paths and deduplicate them. User-defined paths extend (not replace) our default security paths.
	const mergedRedact = Array.from(
		new Set([...DEFAULT_REDACT_PATHS, ...(options.redact ?? [])]),
	);

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

	if (isProduction) {
		return pino(baseConfig);
	}

	return pino(
		baseConfig,
		pretty({
			// Disable pino-pretty's built-in colorization; we apply custom colors
			colorize: false,
			translateTime: 'HH:MM:ss',
			ignore: 'pid,hostname,name,level',
			sync: true,
			messageFormat: (log, messageKey) => {
				const name = (log as { name?: string }).name ?? DEFAULT_LOGGER_NAME;
				const level = (log as { level?: string }).level ?? 'info';
				const message = (log as Record<string, unknown>)[messageKey] as string;
				return `${getColoredName(name)} ${getColoredLevel(level)}: ${message}`;
			},
		}),
	);
}

export type Logger = ReturnType<typeof createLogger>;
