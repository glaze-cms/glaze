import type { CORSConfig } from '@elysiajs/cors';

/**
 * User-facing security configuration.
 * All fields are optional - sensible defaults are applied internally.
 */
export interface SecurityConfig {
	/** CORS (Cross-Origin Resource Sharing) configuration. */
	cors?: {
		/**
		 * Control which websites can access your API from a browser.
		 * @default true in development, false in production
		 */
		origin?: CORSConfig['origin'];

		/**
		 * HTTP methods allowed for CORS.
		 * @default ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
		 */
		methods?: CORSConfig['methods'];

		/**
		 * HTTP headers allowed for CORS.
		 * @default ["Content-Type", "Authorization"]
		 */
		allowedHeaders?: CORSConfig['allowedHeaders'];
	};

	/** Rate limiting configuration. */
	rateLimit?: {
		/**
		 * Whether rate limiting is enabled.
		 * @default true
		 */
		enabled?: boolean;

		/**
		 * Maximum number of requests allowed within the duration.
		 * @default 60
		 */
		max?: number;

		/**
		 * The time window in milliseconds for the rate limit.
		 * @default 60000 (1 minute)
		 */
		duration?: number;

		/**
		 * Custom key generator for rate limiting.
		 * By default, Glaze uses the client's IP address (`server.requestIP()`).
		 */
		generator?: (req: Request, server: any) => string | Promise<string>;
	};
}

/**
 * Resolved security configuration after defaults are applied.
 * All fields are required except those that depend on runtime context.
 */
export interface ResolvedSecurityConfig {
	/** Resolved CORS configuration with defaults applied. */
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

	/** Resolved rate limiting configuration with defaults applied. */
	rateLimit: {
		/**
		 * Whether rate limiting is enabled.
		 * @default true
		 */
		enabled: boolean;

		/**
		 * Maximum number of requests allowed within the duration.
		 * @default 60
		 */
		max: number;

		/**
		 * The time window in milliseconds for the rate limit.
		 * @default 60000 (1 minute)
		 */
		duration: number;

		/**
		 * Custom key generator for rate limiting.
		 * By default, Glaze uses the client's IP address (`server.requestIP()`).
		 */
		generator?: (req: Request, server: any) => string | Promise<string>;
	};
}
