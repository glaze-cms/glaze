import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

/* Consts */
import {
	DEFAULT_ADMIN_PREFIX,
	DEFAULT_API_PREFIX,
	DEFAULT_HEALTH_CHECK_PATH,
} from '../../lib/consts';

/* Types */
import type { Logger } from '@glaze/logger';
import type { GlazeConfig } from '../../config';

/**
 * Internal schema for validating GlazeConfig runtime values.
 * Validates core server configuration fields with proper defaults.
 */
const GlazeConfigSchema = Type.Object({
	apiPrefix: Type.String({
		minLength: 1,
		pattern: '^/',
		default: DEFAULT_API_PREFIX,
	}),
	adminPrefix: Type.String({
		minLength: 1,
		pattern: '^/',
		default: DEFAULT_ADMIN_PREFIX,
	}),
	healthCheck: Type.Object(
		{
			enabled: Type.Boolean({ default: true }),
			path: Type.String({
				minLength: 1,
				pattern: '^/',
				default: DEFAULT_HEALTH_CHECK_PATH,
			}),
		},
		{ default: {} },
	),
});

type ValidatedConfig = Static<typeof GlazeConfigSchema>;

/**
 * Full internal configuration type including all user-provided fields
 * with validated fields having defaults applied.
 */
export type GlazeInternalConfig = GlazeConfig & ValidatedConfig;

type ValidateConfigResult =
	| { success: true; config: ValidatedConfig }
	| {
			success: false;
			errors: Array<{ field: string; message: string; hint: string }>;
	  };

/**
 * Validates the GlazeConfig object using TypeBox.
 * This performs runtime validation and applies defaults for optional fields.
 *
 * @param config - The user-provided GlazeConfig
 * @returns Validation result with either validated config or errors
 */
function parseConfig(config: GlazeConfig): ValidateConfigResult {
	// Extract fields that need validation with defaults
	const configToValidate = {
		apiPrefix: config.apiPrefix,
		adminPrefix: config.adminPrefix,
		healthCheck: config.healthCheck,
	};

	// Apply defaults
	const defaultedConfig = Value.Default(
		GlazeConfigSchema,
		Value.Clone(configToValidate),
	) as ValidatedConfig;

	// Validate
	const errors = [...Value.Errors(GlazeConfigSchema, defaultedConfig)];

	if (errors.length > 0) {
		const errorMap = new Map<
			string,
			{ field: string; message: string; hint: string }
		>();

		for (const err of errors) {
			// TypeBox paths start with '/' for top-level properties
			const field = err.path.slice(1);
			if (!errorMap.has(field)) {
				errorMap.set(field, {
					field,
					message: err.message,
					hint: ` 👉 Ensure "${field}" is set correctly in your Glaze config`,
				});
			}
		}

		return {
			success: false,
			errors: Array.from(errorMap.values()),
		};
	}

	return {
		success: true,
		config: Value.Cast(GlazeConfigSchema, defaultedConfig),
	};
}

/**
 * Validates and normalizes the GlazeConfig with error logging.
 * Combines parsing with user-friendly error reporting via logger.
 *
 * @param logger - Logger instance for error output
 * @param config - The user-provided GlazeConfig
 * @returns The validated configuration object with defaults applied
 *
 * @remarks
 * This function calls `parseConfig()` internally and exits the process (code 1)
 * if validation fails, logging all errors via the provided logger.
 */
export function validateConfig(
	logger: Logger,
	config?: GlazeConfig,
): GlazeInternalConfig {
	if (!config) {
		logger.info('⚠️ No Glaze config provided, using defaults');
		return Value.Default(GlazeConfigSchema, {}) as GlazeInternalConfig;
	}

	const parsedConfig = parseConfig(config);

	if (!parsedConfig.success) {
		logger.error('🛑 Configuration validation failed');
		for (const error of parsedConfig.errors) {
			logger.error(`Config "${error.field}": ${error.message}`);
			logger.info(error.hint);
		}
		process.exit(1);
	}

	// Return full config: original user values + validated values with defaults
	return {
		...config,
		apiPrefix: parsedConfig.config.apiPrefix,
		adminPrefix: parsedConfig.config.adminPrefix,
		healthCheck: parsedConfig.config.healthCheck,
	};
}
