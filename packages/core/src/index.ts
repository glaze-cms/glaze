import { Elysia } from 'elysia';
import { validateEnv } from '@glaze/core/server/validators';
import { createLogger } from '@glaze/logger';

export function glaze() {
	const logger = createLogger({ name: 'GLAZE' });

	/* Parse and validate environment variables */
	validateEnv(logger);

	const app = new Elysia().listen(process.env.PORT ?? 4000);

	return app;
}
