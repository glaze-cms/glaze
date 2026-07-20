import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import type {
	CreateDatabaseOptions,
	DatabaseHandle,
	DialectAdapter,
	RawExecutor,
} from './types.ts';

/**
 * Opens a Postgres connection with `postgres.js` and wraps it in Drizzle.
 *
 * @param options - Must include a Postgres connection string.
 * @returns A live database handle.
 */
async function createDatabase(options: CreateDatabaseOptions): Promise<DatabaseHandle> {
	const client = postgres(options.connection);
	const db = drizzle({ client });

	return {
		db,
		async raw(sql: string) {
			const rows = await client.unsafe(sql);
			return rows as Array<Record<string, unknown>>;
		},
		async transaction<T>(fn: (tx: RawExecutor) => Promise<T>): Promise<T> {
			// postgres.js `begin` reserves one connection for the whole transaction and
			// commits/rolls back around the callback.
			const result = await client.begin(async (txClient) => {
				const tx: RawExecutor = async (sql) => {
					const rows = await txClient.unsafe(sql);
					return rows as Array<Record<string, unknown>>;
				};
				return fn(tx);
			});
			return result as T;
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
