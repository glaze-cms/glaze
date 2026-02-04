import type { LoggerOptions } from '@glaze/logger';
import type { HealthCheckConfig } from './health';
import type { SecurityConfig } from './security';

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

	/**
	 * Drizzle schema containing your database table definitions.
	 *
	 * Import all table definitions from your Drizzle schema files and pass them as an object.
	 *
	 * @example
	 * ```ts
	 * import * as schema from './schema';
	 *
	 * const config: GlazeConfig = {
	 *   schema,
	 *   // ...other options
	 * };
	 * ```
	 */
	schema: Record<string, unknown>;

	/** Security configuration (CORS, etc.) */
	security?: SecurityConfig;

	/**
	 * Health check configuration.
	 * When undefined, a health check endpoint is registered at `/_health` by default.
	 * To disable, pass `{ enabled: false }`. Not recommended for production environments.
	 */
	healthCheck?: HealthCheckConfig;
}
