import { Elysia } from 'elysia';
import { rateLimit } from 'elysia-rate-limit';

import type { GlazeEnv, GlazeInternalConfig } from '@glaze/config';
import type { Logger } from '@glaze/logger';

export const rateLimitPlugin = (
	config: GlazeInternalConfig['security'],
	env: GlazeEnv,
	logger?: Logger,
) => {
	const app = new Elysia({ name: '@glaze/rate-limit' });
	const { rateLimit: rateLimitConfig } = config;

	/**
	 * TODO: Implement LRU/Redis cache for banning periods
	 *
	 * Current implementation uses elysia-rate-limit which only provides
	 * sliding window rate limiting without persistent ban state.
	 *
	 * Future enhancement: Add a tiered banning system:
	 * - Track repeated violations per IP
	 * - Escalate penalties (1min -> 5min -> 1hr -> permanent)
	 * - Use LRU cache for short-term or Redis for distributed/persistent storage
	 */

	const isProduction =
		env.NODE_ENV !== 'development' && env.NODE_ENV !== 'local';

	if (!rateLimitConfig.enabled) {
		if (isProduction && logger) {
			logger.warn(
				'Rate limiting is not enabled in production. This may expose your application to DDoS attacks.',
			);
		}
		return app;
	}

	return app.use(
		rateLimit({
			...rateLimitConfig,
			scoping: 'global',
			errorResponse: new Response(
				JSON.stringify({
					error: 'Rate limit exceeded',
					message: 'Too many requests. Please try again later.',
				}),
				{
					status: 429,
					headers: {
						'Content-Type': 'application/json',
					},
				},
			),
			generator:
				rateLimitConfig.generator ??
				((req: Request, server) => {
					const ip = (
						server as {
							requestIP?: (req: Request) => { address: string } | null;
						} | null
					)?.requestIP?.(req);
					return ip?.address ?? '';
				}),
		}),
	);
};
