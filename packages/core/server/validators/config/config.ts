import Type from 'typebox';
import Compile from 'typebox/compile';

/* Types */
import type { Logger } from '@glaze/logger';
import type { GlazeConfig } from '../../config/types';

/**
 * Schema for validating user-provided GlazeConfig values.
 * Only validates structure and constraints - does NOT apply defaults.
 * Defaults are applied separately in the resolver.
 */
const GlazeConfigValidationSchema = Type.Object({
	apiPrefix: Type.Optional(
		Type.String({
			minLength: 1,
			pattern: '^/',
		}),
	),
	adminPrefix: Type.Optional(
		Type.String({
			minLength: 1,
			pattern: '^/',
		}),
	),
	schema: Type.Record(Type.String(), Type.Unknown()),
	healthCheck: Type.Optional(
		Type.Object({
			enabled: Type.Optional(Type.Boolean()),
			path: Type.Optional(
				Type.String({
					minLength: 1,
					pattern: '^/',
				}),
			),
		}),
	),
	security: Type.Optional(
		Type.Object({
			cors: Type.Optional(
				Type.Object({
					origin: Type.Optional(
						Type.Union([
							Type.Boolean(),
							Type.String(),
							// Use Unknown to accept RegExp objects (common CORS use case)
							// Validation is handled by @elysiajs/cors at runtime
							Type.Unknown(),
							Type.Array(Type.Union([Type.String(), Type.Unknown()])),
						]),
					),
					methods: Type.Optional(Type.Array(Type.String())),
					allowedHeaders: Type.Optional(Type.Array(Type.String())),
				}),
			),
		}),
	),
	logger: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

// Compile schema once for efficient validation
const ConfigValidator = Compile(GlazeConfigValidationSchema);

type ValidationResult =
	| { success: true }
	| {
			success: false;
			errors: Array<{ field: string; message: string; hint: string }>;
	  };

/**
 * Validates the GlazeConfig object using TypeBox.
 * Only validates structure and constraints - does NOT apply defaults.
 *
 * @param config - The user-provided GlazeConfig
 * @returns Validation result
 */
function validateStructure(config: GlazeConfig): ValidationResult {
	const errors = [...ConfigValidator.Errors(config)];

	if (errors.length > 0) {
		const errorMap = new Map<
			string,
			{ field: string; message: string; hint: string }
		>();

		for (const err of errors) {
			// TypeBox instancePath starts with '/' for top-level properties
			// For missing required properties, instancePath is empty and the property name is in params
			let field: string;
			if (err.instancePath === '' && 'requiredProperties' in err.params) {
				// Required property error - get the first missing property
				field =
					(err.params as { requiredProperties: string[] })
						.requiredProperties[0] ?? '';
			} else if (err.instancePath === '' && 'missingProperty' in err.params) {
				// Single missing property error
				field = (err.params as { missingProperty: string }).missingProperty;
			} else {
				// Regular property error - slice(1) removes the leading '/'
				field = err.instancePath.slice(1);
			}

			if (!field || errorMap.has(field)) {
				continue;
			}

			errorMap.set(field, {
				field,
				message: err.message,
				hint: ` 👉 Ensure "${field}" is set correctly in your Glaze config`,
			});
		}

		return {
			success: false,
			errors: Array.from(errorMap.values()),
		};
	}

	return { success: true };
}

/**
 * Validates user configuration without applying defaults.
 * Logs errors and exits if validation fails.
 *
 * @param logger - Logger instance for error output
 * @param config - The user-provided GlazeConfig
 * @returns The original config (validation passed)
 *
 * @remarks
 * This function only validates - defaults are applied separately by resolveConfig().
 * This function exits the process (code 1) if validation fails.
 */
export function validateConfig(
	logger: Logger,
	config?: GlazeConfig,
): GlazeConfig {
	if (!config) {
		logger.info('⚠️ No Glaze config provided, will use defaults');
		// Return minimal valid config (schema is required)
		return { schema: {} };
	}

	const validation = validateStructure(config);

	if (!validation.success) {
		logger.error('🛑 Configuration validation failed');
		for (const error of validation.errors) {
			logger.error(`Config "${error.field}": ${error.message}`);
			logger.info(error.hint);
		}
		process.exit(1);
	}

	// Return original config - defaults applied separately by resolver
	return config;
}
