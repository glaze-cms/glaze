/**
 * Glaze Blog Example - Development Server
 */

import { createGlazeServer } from '@glaze/core';
import { logger } from '@glaze/logger';
import { startDevServer } from '@glaze/shared';

import * as schema from './schema';

const DATABASE_URL = process.env.DATABASE_URL;
const PORT = Number(process.env.PORT ?? 4000);

if (!DATABASE_URL) {
	logger.error(`
❌ DATABASE_URL is required.

Run with:
  DATABASE_URL=postgres://user:pass@localhost:5432/glaze_blog bun dev

Or create a .env file:
  DATABASE_URL=postgres://user:pass@localhost:5432/glaze_blog
`);
	process.exit(1);
}

const glaze = createGlazeServer({
	database: DATABASE_URL,
	schema,
});

startDevServer(glaze, PORT);
