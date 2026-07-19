import { resolveRuntime } from '../runtime/index.ts';

import type { CreateDatabaseOptions, DatabaseHandle, DialectAdapter } from './types.ts';

/**
 * Reports whether a statement returns rows (SELECT/PRAGMA/WITH), so {@link DatabaseHandle.raw}
 * can pick the right SQLite API (querying vs. executing).
 *
 * @param sql - The SQL statement.
 * @returns `true` when the statement yields rows.
 */
function isQueryStatement(sql: string): boolean {
	const head = sql.trimStart().toLowerCase();
	return head.startsWith('select') || head.startsWith('pragma') || head.startsWith('with');
}

/**
 * Opens a SQLite database using Bun's native `bun:sqlite` driver.
 * @param path - The SQLite file path.
 * @returns A live database handle.
 */
async function createBunSqlite(path: string): Promise<DatabaseHandle> {
	const { Database } = await import('bun:sqlite');
	const { drizzle } = await import('drizzle-orm/bun-sqlite');
	const client = new Database(path);
	const db = drizzle(client);

	return {
		db,
		raw(sql: string) {
			const rows = isQueryStatement(sql) ? client.query(sql).all() : (client.run(sql), []);
			return Promise.resolve(rows as Array<Record<string, unknown>>);
		},
		close() {
			client.close();
			return Promise.resolve();
		},
	};
}

/**
 * Opens a SQLite database using the Node `2` driver.
 * @param path - The SQLite file path.
 * @returns A live database handle.
 */
async function createNodeSqlite(path: string): Promise<DatabaseHandle> {
	const { default: Database } = await import('better-sqlite3');
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const client = new Database(path);
	const db = drizzle(client);

	return {
		db,
		raw(sql: string) {
			const rows = isQueryStatement(sql) ? client.prepare(sql).all() : (client.exec(sql), []);
			return Promise.resolve(rows as Array<Record<string, unknown>>);
		},
		close() {
			client.close();
			return Promise.resolve();
		},
	};
}

/**
 * Opens a SQLite connection, choosing the native driver for the current runtime
 * (`bun:sqlite` on Bun, `better-sqlite3` on Node) via the runtime seam.
 *
 * @param options - Must include the SQLite file path as `connection`.
 * @returns A live database handle.
 */
async function createDatabase(options: CreateDatabaseOptions): Promise<DatabaseHandle> {
	const runtime = resolveRuntime();
	return runtime.name === 'bun'
		? createBunSqlite(options.connection)
		: createNodeSqlite(options.connection);
}

/** The SQLite dialect adapter (bun:sqlite on Bun, better-sqlite3 on Node). */
export const sqliteDialect: DialectAdapter = {
	dialect: 'sqlite',
	createDatabase,
};
