import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import type { CreateDatabaseOptions, DatabaseHandle, DialectAdapter } from './types.ts';

/**
 * Opens a Postgres connection with `postgres.js` and wraps it in Drizzle.
 *
 * @param options - Must include a Postgres connection string.
 * @returns A live database handle.
 */
async function createDatabase(options: CreateDatabaseOptions): Promise<DatabaseHandle> {
	const client = postgres(options.connection);
	const db = drizzle(client);

	return {
		db,
		async raw(sql: string) {
			const rows = await client.unsafe(sql);
			return rows as Array<Record<string, unknown>>;
		},
		async close() {
			await client.end();
		},
	};
}

/** The Postgres dialect adapter (postgres.js on Bun and Node). */
export const postgresDialect: DialectAdapter = {
	dialect: 'postgres',
	createDatabase,
};
