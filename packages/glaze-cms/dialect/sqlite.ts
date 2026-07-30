import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';

import { resolveRuntime } from '../runtime/index.ts';
import { classifySqliteConstraint } from './errors.ts';

import type {
	CreateDatabaseOptions,
	DatabaseHandle,
	DialectAdapter,
	RawExecutor,
	Transactor,
} from './types.ts';

/**
 * Create-once materialization of a schema's tables into SQLite: if they don't exist yet, generate
 * their CREATE DDL purely from the schema snapshot (drizzle-kit computes dialect-correct DDL without
 * ever introspecting the live DB) and apply it atomically. Never diffs against the database, so it
 * cannot drop unrelated user tables.
 *
 * @param schema - A Drizzle schema module object (keyed table definitions).
 * @param raw - Runs a read query (used for the existence guard).
 * @param transaction - Runs the CREATE statements as one all-or-nothing unit.
 * @returns The CREATE statements applied (empty when the tables already existed).
 */
async function ensureSqliteSchema(
	schema: Record<string, unknown>,
	raw: RawExecutor,
	transaction: Transactor,
): Promise<string[]> {
	if (await sqliteTablesExist(schema, raw)) return [];

	const { generateDrizzleJson, generateMigration } = await import('drizzle-kit/payload/sqlite');
	const empty = await generateDrizzleJson({});
	const target = await generateDrizzleJson(schema);
	const statements = await generateMigration(empty, target);

	await transaction(async (run) => {
		// Sequential and in order: tables are created in dependency order on one connection.
		// eslint-disable-next-line no-await-in-loop
		for (const statement of statements) await run(statement);
	});
	return statements;
}

/**
 * Reports whether every SQLite table in `schema` already exists (the create-once guard). A partial
 * result returns `false`, so materialization retries and fails loud on the conflicting CREATE rather
 * than silently skipping.
 *
 * @param schema - The Drizzle schema module.
 * @param raw - Runs the introspection query.
 * @returns `true` when all of the schema's tables exist.
 */
async function sqliteTablesExist(
	schema: Record<string, unknown>,
	raw: RawExecutor,
): Promise<boolean> {
	const names = sqliteTableNames(schema);
	if (names.length === 0) return true;

	for (const name of names) {
		// Sequential with early return on the first missing table.
		// eslint-disable-next-line no-await-in-loop
		const rows = await raw(
			`select 1 from sqlite_master where type = 'table' and name = ${quoteLiteral(name)} limit 1`,
		);
		if (rows.length === 0) return false;
	}
	return true;
}

/**
 * The table names of every SQLite table in a schema module, read from the tables themselves.
 *
 * @param schema - The Drizzle schema module.
 * @returns One name per SQLite table.
 */
function sqliteTableNames(schema: Record<string, unknown>): string[] {
	const names: string[] = [];
	for (const value of Object.values(schema)) {
		if (!is(value, SQLiteTable)) continue;
		names.push(getTableConfig(value).name);
	}
	return names;
}

/**
 * Quotes a string as a SQL literal (single-quote escaped).
 *
 * @param literal - The value to quote.
 * @returns The single-quoted, escaped literal.
 */
function quoteLiteral(literal: string): string {
	return `'${literal.replace(/'/g, "''")}'`;
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
	const db = drizzle({ client });

	// Route by whether the prepared statement returns rows (empty `columnNames` ⇒ a writer), not by
	// keyword — a write PRAGMA or CTE looks like a query but must run, not be `.all()`-ed.
	const runRaw: RawExecutor = (sql) => {
		const statement = client.query(sql);
		const rows = statement.columnNames.length > 0 ? statement.all() : (statement.run(), []);
		return Promise.resolve(rows as Array<Record<string, unknown>>);
	};

	// SQLite is single-connection here, so BEGIN/COMMIT/ROLLBACK on the same handle is the
	// transaction. A failed statement does not auto-rollback in SQLite, so rollback is explicit.
	const runTransaction: Transactor = async (fn) => {
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
	};

	return {
		db,
		raw: runRaw,
		transaction: runTransaction,
		ensureSchema: (schema) => ensureSqliteSchema(schema, runRaw, runTransaction),
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
	const db = drizzle({ client });

	// `better-sqlite3` throws on `.all()` for a non-returning statement, so route by the prepared
	// statement's `reader` flag rather than by keyword (a write PRAGMA/CTE is not a reader).
	const runRaw: RawExecutor = (sql) => {
		const statement = client.prepare(sql);
		const rows = statement.reader ? statement.all() : (statement.run(), []);
		return Promise.resolve(rows as Array<Record<string, unknown>>);
	};

	const runTransaction: Transactor = async (fn) => {
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
	};

	return {
		db,
		raw: runRaw,
		transaction: runTransaction,
		ensureSchema: (schema) => ensureSqliteSchema(schema, runRaw, runTransaction),
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
	classifyConstraint: classifySqliteConstraint,
};
