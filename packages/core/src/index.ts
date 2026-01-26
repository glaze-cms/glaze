import { validateEnv } from '@glaze/core/server/validators';
import { createLogger } from '@glaze/logger';

export function glaze() {
	const logger = createLogger({ name: 'GLAZE' });

	/* Parse and validate environment variables */
	validateEnv(logger);
}
