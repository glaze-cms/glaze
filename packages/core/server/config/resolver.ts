import { deepMerge } from '@glaze/shared';
import type { GlazeConfig, GlazeInternalConfig } from './types';
import {
	DEFAULT_API_PREFIX,
	DEFAULT_ADMIN_PREFIX,
	DEFAULT_HEALTH_CHECK_PATH,
	DEFAULT_CORS_METHODS,
	DEFAULT_CORS_ALLOWED_HEADERS,
} from '../lib/consts';
import { authResolver } from '../plugins/auth/resolver';

/**
 * Creates a fresh default configuration object.
 * Returns a new instance each call to prevent mutation across resolves.
 */
function createDefaultConfig(apiPrefix: string): GlazeInternalConfig {
	return {
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
		auth: authResolver(apiPrefix),
	};
}

/**
 * Resolves user configuration with default values.
 * Deep merges user config with defaults to produce the internal config.
 *
 * @param userConfig - User-provided configuration
 * @returns Resolved configuration with all defaults applied
 */
export function resolveConfig(userConfig: GlazeConfig): GlazeInternalConfig {
	const apiPrefix = userConfig.apiPrefix ?? DEFAULT_API_PREFIX;
	const mergedConfig = deepMerge(
		createDefaultConfig(apiPrefix),
		userConfig as Partial<GlazeInternalConfig>,
	);

	// Resolve auth config with the final apiPrefix
	mergedConfig.auth = authResolver(mergedConfig.apiPrefix, userConfig.auth);

	return mergedConfig;
}
