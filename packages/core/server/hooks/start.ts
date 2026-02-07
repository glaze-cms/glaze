import { DrizzleQueryError, sql } from 'drizzle-orm';

import type { Glaze } from '@glaze/core';

export async function handleStart({
	decorator,
}: {
	decorator: Glaze['decorator'];
}) {
	const { logger, db } = decorator;

	await db.execute(sql`SELECT 1`).catch((e: unknown) => {
		logger.error('Could not connect to database.');
		logger.info(' 👉 Please make sure the database is running and accessible.');

		if (e instanceof DrizzleQueryError && e.cause instanceof Error) {
			logger.debug(e.cause.message);
		}
		process.exit(1);
	});
}
