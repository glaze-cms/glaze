import type { AuthConfig, ResolvedAuthConfig } from '../../config/types';

/**
 * Resolves auth configuration with sensible defaults.
 *
 * @param authConfig - User-provided auth configuration (optional)
 * @param apiPrefix - The API prefix from config (e.g., "/api")
 * @returns Resolved auth configuration with defaults applied
 *
 * @remarks
 * Default behavior:
 * - Better Auth always runs (required for admin authentication)
 * - Public auth is enabled by default (set `enabled: false` to disable end-user routes)
 * - Base path defaults to `${apiPrefix}/auth` (e.g., "/api/auth")
 * - Email and password authentication is enabled by default
 * - Email verification is disabled by default (can be enabled by user)
 */
export function authResolver(
	apiPrefix: string,
	authConfig?: AuthConfig,
): ResolvedAuthConfig {
	// Public auth is enabled by default, only disabled if explicitly set to false
	const publicAuthEnabled = authConfig?.enabled ?? true;
	const hasUserAuthConfig =
		authConfig !== undefined && authConfig.enabled !== false;

	return {
		appName: 'Glaze CMS',
		basePath: `${apiPrefix}/auth`,
		publicAuthEnabled,
		emailAndPassword: {
			...(hasUserAuthConfig ? authConfig.emailAndPassword : undefined),
			enabled: true,
		},
		emailVerification: hasUserAuthConfig
			? authConfig.emailVerification
			: undefined,
	};
}
