import { Elysia } from 'elysia';
import cors from '@elysiajs/cors';

import type { SecurityConfig } from '../../../config/types/security';
import type { Logger } from '@glaze/logger';

/**
 * Creates Elysia CORS middleware with environment-aware defaults.
 *
 * **Default Behavior:**
 * - Development (`NODE_ENV === 'development'`): `origin: true` (allow all)
 * - Production: `origin: false` (deny all - explicit configuration required)
 *
 * **Security Notes:**
 * - Credentials are always enabled for Better Auth cookie-based authentication
 * - Always configure explicit origins in production (e.g., `['https://myapp.com']`)
 *
 * @param config - The security configuration containing CORS settings.
 * @param logger - The logger instance for diagnostics.
 * @returns The Elysia instance with CORS middleware applied.
 *
 * @example
 * ```typescript
 * // Production: Allow specific origins
 * const app = new Elysia().use(corsPlugin({
 *   cors: { origin: ['https://myapp.com', 'https://admin.myapp.com'] }
 * }));
 *
 * // Development: Allow all (default behavior)
 * const app = new Elysia().use(corsPlugin());
 * ```
 */
export const corsPlugin = (config?: SecurityConfig, logger?: Logger) => {
	const app = new Elysia({ name: '@glaze/cors' });
	const corsConfig = config?.cors;
	const isDevelopment = process.env.NODE_ENV === 'development';

	// Environment-aware default: permissive in dev, restrictive in prod
	const defaultOrigin = isDevelopment;

	// Warn if production is running without explicit CORS origins
	if (!isDevelopment && !corsConfig?.origin && logger) {
		logger.warn(
			'[@glaze/cors] No CORS origins configured in production. All cross-origin requests will be blocked.',
		);
	}

	return app.use(
		cors({
			// Use user config if provided, otherwise apply environment-based default
			origin: corsConfig?.origin ?? defaultOrigin,

			// Always enable credentials for Better Auth cookie-based authentication
			credentials: true,

			// Optional advanced options - use user config or undefined
			methods: corsConfig?.methods,
			allowedHeaders: corsConfig?.allowedHeaders,
		}),
	);
};
