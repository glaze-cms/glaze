import type { CORSConfig } from '@elysiajs/cors';
import type { LoggerOptions } from '@glaze/logger';

/**
 * Resolved security configuration after defaults are applied.
 * All fields are required except those that depend on runtime context.
 */
export interface ResolvedSecurityConfig {
	cors: {
		/**
		 * Control which websites can access your API from a browser.
		 * @default true in development, false in production
		 */
		origin?: CORSConfig['origin'];

		/**
		 * HTTP methods allowed for CORS.
		 * Supports Elysia's full CORSConfig types including '*', boolean, etc.
		 * @default ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
		 */
		methods: CORSConfig['methods'];

		/**
		 * HTTP headers allowed for CORS.
		 * Supports Elysia's full CORSConfig types.
		 * @default ["Content-Type", "Authorization"]
		 */
		allowedHeaders: CORSConfig['allowedHeaders'];
	};
}

/**
 * User-facing security configuration.
 * All fields are optional - sensible defaults are applied internally.
 */
export interface SecurityConfig {
	cors?: {
		origin?: CORSConfig['origin'];
		methods?: CORSConfig['methods'];
		allowedHeaders?: CORSConfig['allowedHeaders'];
	};
}

/**
 * Resolved health check configuration after defaults are applied.
 * All fields are required.
 */
export interface ResolvedHealthCheckConfig {
	/**
	 * Whether health check is enabled.
	 * @default true
	 */
	enabled: boolean;

	/**
	 * Path for health check endpoint.
	 * @default '/_health'
	 */
	path: string;
}

/**
 * User-facing health check configuration.
 * All fields are optional.
 */
export interface HealthCheckConfig {
	enabled?: boolean;
	path?: string;
}

/**
 * Configuration for Glaze server (user-facing).
 * All fields are optional except schema.
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
}
