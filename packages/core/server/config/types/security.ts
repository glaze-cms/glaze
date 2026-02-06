import type { CORSConfig } from '@elysiajs/cors';

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
