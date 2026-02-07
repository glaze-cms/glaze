import Type, { type Static } from 'typebox';
import Compile from 'typebox/compile';
import { Value } from 'typebox/value';

/* Types */
import type { Logger } from '@glaze/logger';

/* Consts */
import { DEFAULT_SERVER_PORT } from '../../lib/consts/defaults';

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
	GLAZE_PORT: Type.Integer({
		default: DEFAULT_SERVER_PORT,
		minimum: 1,
		maximum: 65535,
	}),
	GLAZE_DATABASE_URL: Type.String({
		minLength: 1,
		pattern: '^(postgres|postgresql)://',
	}),
	GLAZE_SERVER_URL: Type.Optional(
		Type.String({
			minLength: 1,
			pattern: '^https?://',
			error:
				'GLAZE_SERVER_URL must be a valid URL starting with http:// or https://',
		}),
	),
});

// Compile schema once for efficient validation
const EnvValidator = Compile(GlazeEnvSchema);

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
	const port = process.env.GLAZE_PORT ?? process.env.PORT;
	const data = {
		...process.env,
		GLAZE_PORT: port ? parseInt(port, 10) : undefined,
		GLAZE_DATABASE_URL:
			process.env.GLAZE_DATABASE_URL ?? process.env.DATABASE_URL,
	};

	// 1. Clone and apply defaults first
	const defaultedEnv = Value.Default(
		GlazeEnvSchema,
		Value.Clone(data),
	) as GlazeEnv;

	// 2. Convert/cast types before validation (e.g., string -> number)
	const convertedEnv = Value.Convert(GlazeEnvSchema, defaultedEnv) as GlazeEnv;

	// 3. Use compiled validator to check for errors
	const errors = [...EnvValidator.Errors(convertedEnv)];

	if (errors.length > 0) {
		// Keep only the first error per variable to avoid redundant messages
		const errorMap = new Map<
			string,
			{ variable: string; message: string; hint: string }
		>();

		// Determine if we're in a local development environment
		const nodeEnv = convertedEnv.NODE_ENV;
		const isLocalEnv = nodeEnv === 'local' || nodeEnv === 'development';

		for (const err of errors) {
			// TypeBox instancePath starts with '/' for top-level properties (e.g., '/DATABASE_URL')
			// For missing required properties, instancePath is empty and the property name is in params
			let variable: string;
			if (err.instancePath === '' && 'missingProperty' in err.params) {
				// Single missing property error
				variable = (err.params as { missingProperty: string }).missingProperty;
			} else if (
				err.instancePath === '' &&
				'requiredProperties' in err.params
			) {
				// Required property error - get the first missing property
				variable =
					(err.params as { requiredProperties: string[] })
						.requiredProperties[0] ?? '';
			} else {
				// Regular property error - slice(1) removes the leading '/'
				variable = err.instancePath.slice(1);
			}

			if (!variable || errorMap.has(variable)) {
				continue;
			}

			const hint = isLocalEnv
				? ` 👉  Set ${variable} to a valid value in your .env file`
				: ` 👉  Set ${variable} as an environment variable in your hosting provider or cloud platform`;

			errorMap.set(variable, {
				variable,
				message: err.message,
				hint,
			});
		}

		return {
			success: false,
			errors: Array.from(errorMap.values()),
		};
	}

	// 4. Success: return converted env
	return {
		success: true,
		env: convertedEnv,
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
