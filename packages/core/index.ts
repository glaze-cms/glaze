import { createLogger } from '@glaze/logger';

/* Validators */
import { validateEnv } from './server/validators/env';

/* Server */
import { createGlazeServer } from './server/server';

export function glaze() {
	const logger = createLogger({ name: 'GLAZE' });
	const env = validateEnv(logger);

	return createGlazeServer({ env, logger });
}

export type Glaze = ReturnType<typeof glaze>;
