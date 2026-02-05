import { deepMerge } from '../../../shared/utils/merge';
import type { GlazeConfig, GlazeInternalConfig } from './types';
import {
	DEFAULT_API_PREFIX,
	DEFAULT_ADMIN_PREFIX,
	DEFAULT_HEALTH_CHECK_PATH,
	DEFAULT_CORS_METHODS,
	DEFAULT_CORS_ALLOWED_HEADERS,
} from '../lib/consts';

/**
 * Default configuration values.
 * These are merged with user-provided config to create the internal config.
 */
const DEFAULT_CONFIG: GlazeInternalConfig = {
	apiPrefix: DEFAULT_API_PREFIX,
	adminPrefix: DEFAULT_ADMIN_PREFIX,
	schema: {}, // Will be overridden by user
	healthCheck: {
		enabled: true,
		path: DEFAULT_HEALTH_CHECK_PATH,
	},
	security: {
		cors: {
			// We spread these because these are read-only arrays and we need mutable ones
			methods: [...DEFAULT_CORS_METHODS],
			allowedHeaders: [...DEFAULT_CORS_ALLOWED_HEADERS],
		},
	},
};

/**
 * Resolves user configuration with default values.
 * Deep merges user config with defaults to produce the internal config.
 *
 * @param userConfig - User-provided configuration
 * @returns Resolved configuration with all defaults applied
 */
export function resolveConfig(userConfig: GlazeConfig): GlazeInternalConfig {
	return deepMerge(DEFAULT_CONFIG, userConfig as Partial<GlazeInternalConfig>);
}
