import { createLogger } from '@glaze/logger';

/* Validators */
import { validateEnv } from './server/validators/env';
import { validateConfig } from './server/validators/config';

/* Server */
import { createGlazeServer } from './server/server';

/* Types */
import type { Strict } from '@glaze/shared';
import type { GlazeConfig } from './server/config/types';

export function glaze<T extends GlazeConfig>({
	config,
}: { config?: Strict<T, GlazeConfig> } = {}) {
	const logger = createLogger({ name: 'GLAZE' });
	const env = validateEnv(logger);
	const internalConfig = validateConfig(logger, config);

	return createGlazeServer({ env, logger, config: internalConfig });
}

export type Glaze = ReturnType<typeof glaze>;
