import type { LoggerOptions } from '@glaze/logger';
import type { HealthCheckConfig } from './types/health';
import type { SecurityConfig } from './types/security';

/**
 * Configuration for Glaze server
 */
export interface GlazeConfig {
	/** API prefix. @default "/api" */
	apiPrefix?: string;

	/** Admin UI prefix. @default "/admin" */
	adminPrefix?: string;

	/** Logger configuration */
	logger?: LoggerOptions;

	/** Security configuration (CORS, etc.) */
	security?: SecurityConfig;

	/**
	 * Health check configuration.
	 * When undefined, a health check endpoint is registered at `/_health` by default.
	 * To disable, pass `{ enabled: false }`. Not recommended for production environments.
	 */
	healthCheck?: HealthCheckConfig;
}
