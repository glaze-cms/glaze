import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import type { Logger } from '@glaze/logger';

/**
 * Internal schema defining the required environment variables for Glaze.
 * Includes automatic defaults for non-critical infrastructure.
 */
const GlazeEnvSchema = Type.Object({
	NODE_ENV: Type.Union(
		[
			Type.Literal('local'),
			Type.Literal('development'),
			Type.Literal('production'),
			Type.Literal('staging'),
			Type.Literal('test'),
		],
		{ default: 'development' },
	),
	GLAZE_AUTH_SECRET: Type.String({
		minLength: 32,
		error: 'For security reasons, AUTH_SECRET must be at least 32 characters',
	}),
	GLAZE_PORT: Type.Integer({ default: 4000, minimum: 1, maximum: 65535 }),
	GLAZE_DATABASE_URL: Type.String({
		minLength: 1,
		pattern: '^(postgres|postgresql)://',
	}),
});

type ParseEnvResult =
	| { success: true; env: GlazeEnv }
	| {
			success: false;
			errors: Array<{ variable: string; message: string; hint: string }>;
	  };

/**
 * Validates and transforms raw environment variables into a typed object.
 * This function performs two main tasks:
 * 1. **Validation**: Checks `process.env` against the `GlazeEnvSchema`.
 * 2. **Parsing/Casting**: Converts string-based env vars into their correct types
 * (e.g., handles defaults and strips unknown variables).
 * @returns An object containing the validation result with `success`, and either `env` or `errors` properties.
 * @example
 * const result = parseEnv();
 * if (!result.success) {
 *   console.error("Missing variables:", result.errors);
 *   process.exit(1);
 * }
 * // TypeScript now knows result.env is safe to access
 * const { DATABASE_URL } = result.env;
 */
export function parseEnv(): ParseEnvResult {
	const data = {
		...process.env,
		GLAZE_PORT:
			process.env.GLAZE_PORT || process.env.PORT
				? parseInt((process.env.GLAZE_PORT || process.env.PORT)!, 10)
				: undefined,
		GLAZE_DATABASE_URL:
			process.env.GLAZE_DATABASE_URL || process.env.DATABASE_URL,
	};

	// 1. Clone and apply defaults first
	const defaultedEnv = Value.Default(
		GlazeEnvSchema,
		Value.Clone(data),
	) as GlazeEnv;

	// 2. Convert/cast types before validation (e.g., string -> number)
	const convertedEnv = Value.Convert(GlazeEnvSchema, defaultedEnv);

	// 3. Validate against converted data
	const errors = [...Value.Errors(GlazeEnvSchema, convertedEnv)];

	if (errors.length > 0) {
		// Keep only the first error per variable to avoid redundant messages
		const errorMap = new Map<
			string,
			{ variable: string; message: string; hint: string }
		>();

		// Determine if we're in a local development environment
		const nodeEnv =
			(convertedEnv as GlazeEnv).NODE_ENV || data.NODE_ENV || 'development';
		const isLocalEnv = nodeEnv === 'local' || nodeEnv === 'development';

		for (const err of errors) {
			// TypeBox paths start with '/' for top-level properties (e.g., '/DATABASE_URL'), slice(1) removes the leading '/' to get the variable name
			const variable = err.path.slice(1);
			if (!errorMap.has(variable)) {
				const hint = isLocalEnv
					? ` 👉  Set ${variable} to a valid value in your .env file`
					: ` 👉  Set ${variable} as an environment variable in your hosting provider or cloud platform`;

				errorMap.set(variable, {
					variable,
					message: err.message,
					hint,
				});
			}
		}

		return {
			success: false,
			errors: Array.from(errorMap.values()),
		};
	}

	// 4. Success: return already converted env
	return {
		success: true,
		env: convertedEnv as GlazeEnv,
	};
}

/**
 * Validates and transforms raw environment variables with error logging.
 * Combines parsing with user-friendly error reporting via logger.
 *
 * @param logger - Logger instance for error output
 * @returns The validated environment object
 *
 * @remarks
 * This function calls `parseEnv()` internally and exits the process (code 1)
 * if validation fails, logging all errors via the provided logger.
 */
export function validateEnv(logger: Logger): GlazeEnv {
	const parsedEnv = parseEnv();

	if (!parsedEnv.success) {
		logger.error('Environment validation failed');
		for (const error of parsedEnv.errors) {
			logger.error(`${error.variable}: ${error.message}`);
			logger.info(error.hint);
		}
		process.exit(1);
	}

	return parsedEnv.env;
}

export type { ParseEnvResult };
export type GlazeEnv = Static<typeof GlazeEnvSchema>;
