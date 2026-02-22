import { DrizzleQueryError, sql } from 'drizzle-orm';
import { runConvergence } from '@glaze/convergence';

import type { Glaze } from '@glaze/core';

export async function handleStart({
	decorator,
}: {
	decorator: Glaze['decorator'];
}) {
	const { logger, db, env, config } = decorator;
	const { sync: convergenceConfig } = config;

	await db.execute(sql`SELECT 1`).catch((e: unknown) => {
		logger.error('Could not connect to database.');
		logger.info(' 👉 Please make sure the database is running and accessible.');

		if (e instanceof DrizzleQueryError && e.cause instanceof Error) {
			logger.debug(e.cause.message);
		}
		process.exit(1);
	});

	const glazeSchemaPath = new URL(import.meta.resolve('@glaze/core/schema'))
		.pathname;

	await runConvergence({
		config: convergenceConfig,
		db,
		logger,
		connectionString: env.GLAZE_DATABASE_URL,
		glazeSchemaPath,
	});
}
