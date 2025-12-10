import { createGlazeServer } from '@glaze/core';
import { logger } from '@glaze/logger';
import * as schema from './schema';

const DATABASE_URL = process.env.DATABASE_URL;
const PORT = Number(process.env.PORT ?? 4000);

if (!DATABASE_URL) {
	logger.error('DATABASE_URL is required');
	process.exit(1);
}

const glaze = createGlazeServer({
	database: DATABASE_URL,
	schema,
});

glaze.listen(PORT);
