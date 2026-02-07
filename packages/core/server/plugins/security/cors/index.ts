export { corsPlugin } from './cors';
import { Elysia } from 'elysia';
import { rateLimit } from 'elysia-rate-limit';

import type { GlazeEnv } from '../../../validators/env';
import type { Logger } from '@glaze/logger';
import type { GlazeInternalConfig } from '../../../validators/config';

export const rateLimitPlugin = (
	config: GlazeInternalConfig['security'],
	env: GlazeEnv,
	logger?: Logger,
) => {
	const app = new Elysia({ name: '@glaze/rate-limit' });
	const { rateLimit: rateLimitConfig } = config;

	// Environment-aware default: permissive in dev, restrictive in prod
	const shouldBePermissive =
		env.NODE_ENV === 'development' || env.NODE_ENV === 'local';

	// Warn if production is running without explicit rate limiting
	if (!shouldBePermissive && !rateLimitConfig.enabled && logger) {
		logger.warn(
			'Rate limiting is not enabled in production. This may expose your application to DDOS attacks.',
		);
	}

	return app.use(
		rateLimit({
			...rateLimitConfig,
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
