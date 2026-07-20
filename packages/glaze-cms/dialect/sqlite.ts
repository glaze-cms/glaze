import { resolveRuntime } from '../runtime/index.ts';

import type {
	CreateDatabaseOptions,
	DatabaseHandle,
	DialectAdapter,
	RawExecutor,
} from './types.ts';

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

	// Route by whether the prepared statement returns rows (empty `columnNames` ⇒ a writer), not by
	// keyword — a write PRAGMA or CTE looks like a query but must run, not be `.all()`-ed.
	const runRaw: RawExecutor = (sql) => {
		const statement = client.query(sql);
		const rows = statement.columnNames.length > 0 ? statement.all() : (statement.run(), []);
		return Promise.resolve(rows as Array<Record<string, unknown>>);
	};

	return {
		db,
		raw: runRaw,
		// SQLite is single-connection here, so BEGIN/COMMIT/ROLLBACK on the same handle is the
		// transaction. A failed statement does not auto-rollback in SQLite, so rollback is explicit.
		async transaction<T>(fn: (tx: RawExecutor) => Promise<T>): Promise<T> {
			client.run('BEGIN');
			try {
				const result = await fn(runRaw);
				client.run('COMMIT');
				return result;
			} catch (error) {
				try {
					client.run('ROLLBACK');
				} catch {
					// Preserve and rethrow the original error; a rollback failure must not mask it.
				}
				throw error;
			}
		},
		close() {
			client.close();
			return Promise.resolve();
		},
	};
}

/**
 * Opens a SQLite database using the Node `better-sqlite3` driver.
 * @param path - The SQLite file path.
 * @returns A live database handle.
 */
async function createNodeSqlite(path: string): Promise<DatabaseHandle> {
	const { default: Database } = await import('better-sqlite3');
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const client = new Database(path);
	const db = drizzle(client);

	// `better-sqlite3` throws on `.all()` for a non-returning statement, so route by the prepared
	// statement's `reader` flag rather than by keyword (a write PRAGMA/CTE is not a reader).
	const runRaw: RawExecutor = (sql) => {
		const statement = client.prepare(sql);
		const rows = statement.reader ? statement.all() : (statement.run(), []);
		return Promise.resolve(rows as Array<Record<string, unknown>>);
	};

	return {
		db,
		raw: runRaw,
		async transaction<T>(fn: (tx: RawExecutor) => Promise<T>): Promise<T> {
			client.exec('BEGIN');
			try {
				const result = await fn(runRaw);
				client.exec('COMMIT');
				return result;
			} catch (error) {
				try {
					client.exec('ROLLBACK');
				} catch {
					// Preserve and rethrow the original error; a rollback failure must not mask it.
				}
				throw error;
			}
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
