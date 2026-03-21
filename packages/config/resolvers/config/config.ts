import { deepMerge } from '@glaze/shared';
import { syncResolver } from '../sync';
import {
	DEFAULT_API_PREFIX,
	DEFAULT_ADMIN_PREFIX,
	DEFAULT_HEALTH_CHECK_PATH,
	DEFAULT_CORS_METHODS,
	DEFAULT_CORS_ALLOWED_HEADERS,
} from '../../consts/defaults';
import { authResolver } from '../auth';

import type { GlazeConfig, GlazeInternalConfig } from '../../types';
import type { GlazeEnv } from '../../env';

/**
 * Creates a fresh default configuration object.
 * @returns A default configuration object with all default values set
 */
function createDefaultConfig(
	nodeEnv: GlazeEnv['NODE_ENV'],
): Omit<GlazeInternalConfig, 'auth' | 'sync'> {
	const isDev = nodeEnv === 'development' || nodeEnv === 'local';

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
			rateLimit: {
				enabled: !isDev,
				max: 60, // 60 requests
				duration: 60000, // 1 minute
			},
		},
	};
}

/**
 * Validates and normalizes path prefixes.
 * Ensures prefix starts with "/" and removes trailing slashes.
 *
 * @param prefix - The path prefix to validate
 * @param name - The name of the prefix for error messages
 * @returns Normalized prefix
 * @throws Error if prefix doesn't start with "/"
 */
function validatePathPrefix(prefix: string, name: string): string {
	if (!prefix.startsWith('/')) {
		throw new Error(`${name} must start with "/"`);
	}
	// Remove trailing slashes to prevent double slashes in paths
	return prefix.replace(/\/+$/, '') || '/';
}

/**
 * Resolves user configuration with default values.
 * Deep merges user config with defaults to produce the internal config.
 *
 * @param userConfig - User-provided configuration
 * @returns Resolved configuration with all defaults applied
 */
export function resolveConfig(userConfig: GlazeConfig): GlazeInternalConfig {
	// Validate and normalize path prefixes before merging
	const normalizedConfig: GlazeConfig = {
		...userConfig,
		apiPrefix:
			userConfig.apiPrefix !== undefined
				? validatePathPrefix(userConfig.apiPrefix, 'apiPrefix')
				: undefined,
		adminPrefix:
			userConfig.adminPrefix !== undefined
				? validatePathPrefix(userConfig.adminPrefix, 'adminPrefix')
				: undefined,
	};

	const nodeEnv =
		(process.env.NODE_ENV as GlazeEnv['NODE_ENV'] | undefined) ?? 'development';

	const mergedConfig = deepMerge(
		createDefaultConfig(nodeEnv),
		normalizedConfig as Partial<GlazeInternalConfig>,
	);

	const apiPrefix = mergedConfig.apiPrefix;

	return {
		...mergedConfig,
		auth: authResolver(apiPrefix, userConfig.auth),
		sync: syncResolver(nodeEnv, userConfig.sync),
	};
}
