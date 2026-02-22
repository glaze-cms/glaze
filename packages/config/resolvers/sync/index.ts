import type { SyncConfig, SoloWorkflowConfig } from '../../types';

type NodeEnv = 'local' | 'development' | 'production' | 'staging' | 'test';

/**
 * Determines whether the current environment is a production-like environment.
 */
function isProductionLike(nodeEnv: NodeEnv): boolean {
	return nodeEnv === 'production' || nodeEnv === 'staging';
}

/**
 * Resolves solo workflow defaults based on environment.
 *
 * Development: destructive='ask', validation='permissive'
 * Production:  destructive='fail', validation='strict'
 */
function resolveSoloDefaults(
	nodeEnv: NodeEnv,
	userConfig?: SoloWorkflowConfig,
): Required<Omit<SoloWorkflowConfig, 'configPath'>> {
	const isProd = isProductionLike(nodeEnv);

	return {
		destructive: userConfig?.destructive ?? (isProd ? 'fail' : 'ask'),
		validation: userConfig?.validation ?? (isProd ? 'strict' : 'permissive'),
	};
}

/**
 * Resolves sync configuration with environment-aware defaults.
 *
 * @param nodeEnv - Current NODE_ENV value
 * @param userConfig - User-provided sync configuration (optional)
 * @returns Fully resolved sync configuration
 */
export function syncResolver(
	nodeEnv: NodeEnv,
	userConfig?: SyncConfig,
): SyncConfig {
	const enabled = userConfig?.enabled ?? true;
	const workflow = userConfig?.workflow ?? 'solo';

	if (workflow === 'solo') {
		const userSoloConfig =
			userConfig?.workflow === 'solo' ? userConfig.solo : undefined;
		return {
			enabled,
			workflow: 'solo',
			solo: {
				...resolveSoloDefaults(nodeEnv, userSoloConfig),
				configPath: userSoloConfig?.configPath,
			},
		};
	}

	// Team workflow defaults (for future use)
	return {
		enabled,
		workflow: 'team',
		team: {
			autoRun:
				userConfig?.workflow === 'team'
					? (userConfig.team?.autoRun ?? !isProductionLike(nodeEnv))
					: !isProductionLike(nodeEnv),
			configPath:
				userConfig?.workflow === 'team'
					? (userConfig.team?.configPath ?? 'drizzle.config.ts')
					: 'drizzle.config.ts',
		},
	};
}
