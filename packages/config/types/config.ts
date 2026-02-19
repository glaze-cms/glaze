import type { LoggerOptions } from '@glaze/logger';
import type { SyncConfig } from './sync';
import type { ResolvedSecurityConfig, SecurityConfig } from './security';
import type { HealthCheckConfig, ResolvedHealthCheckConfig } from './health';
import type { AuthConfig, ResolvedAuthConfig } from './auth';

/**
 * Configuration for Glaze server (user-facing).
 * All fields are optional except schema.
 */
export interface GlazeConfig {
	/** Admin UI prefix. @default "/admin" */
	adminPrefix?: string;

	/** API prefix. @default "/api" */
	apiPrefix?: string;

	/** Authentication configuration */
	auth?: AuthConfig;

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

	/**
	 * Database synchronization configuration.
	 * Controls how schema changes are detected and applied.
	 *
	 * @default { enabled: true, workflow: 'solo' }
	 */
	sync?: SyncConfig;
}

/**
 * Internal resolved configuration for Glaze server.
 * This is what the framework uses internally after validation and resolution.
 * All optional fields from GlazeConfig have been populated with defaults.
 */
export interface GlazeInternalConfig {
	/** API prefix. @default "/api" */
	apiPrefix: string;

	/** Admin UI prefix. @default "/admin" */
	adminPrefix: string;

	/** Logger configuration */
	logger?: LoggerOptions;

	/**
	 * Drizzle schema containing your database table definitions.
	 */
	schema: Record<string, unknown>;

	/** Security configuration (CORS, etc.) - resolved with defaults */
	security: ResolvedSecurityConfig;

	/** Health check configuration - resolved with defaults */
	healthCheck: ResolvedHealthCheckConfig;

	/** Authentication configuration - resolved with defaults */
	auth: ResolvedAuthConfig;

	/** Database synchronization configuration - resolved with defaults */
	sync: SyncConfig;
}
