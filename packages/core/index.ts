import { createLogger } from '@glaze/logger';

/* Config */
import { validateEnv, validateConfig, resolveConfig } from '@glaze/config';
import type { GlazeConfig } from '@glaze/config';

/* Server */
import { createGlazeServer } from './server/server';

export function glaze({ config }: { config?: GlazeConfig } = {}) {
	const logger = createLogger({ name: 'GLAZE' });
	const env = validateEnv(logger);
	const validatedConfig = validateConfig(logger, config);
	const internalConfig = resolveConfig(validatedConfig);

	const server = createGlazeServer({ env, logger, config: internalConfig });

	server.listen({ port: env.GLAZE_PORT });

	return server;
}

export type Glaze = ReturnType<typeof glaze>;
