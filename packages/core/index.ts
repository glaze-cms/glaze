import { createLogger } from '@glaze/logger';

/* Validators */
import { validateEnv } from './server/validators/env';
import { validateConfig } from './server/validators/config';

/* Resolver */
import { resolveConfig } from './server/config/resolver';

/* Server */
import { createGlazeServer } from './server/server';

/* Types */
import type { GlazeConfig } from './server/config/types';

export async function glaze({ config }: { config?: GlazeConfig } = {}) {
	const logger = createLogger({ name: 'GLAZE' });
	const env = validateEnv(logger);
	const validatedConfig = validateConfig(logger, config);
	const internalConfig = resolveConfig(validatedConfig);

	const server = createGlazeServer({ env, logger, config: internalConfig });

	await server.listen({ port: env.GLAZE_PORT });

	return server;
}

export type Glaze = ReturnType<typeof glaze>;
