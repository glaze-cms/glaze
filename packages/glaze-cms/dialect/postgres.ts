import { is } from 'drizzle-orm';
import { getTableConfig, PgTable, pgSchema } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { classifyPostgresConstraint } from './errors.ts';

import type {
	CreateDatabaseOptions,
	DatabaseHandle,
	DialectAdapter,
	RawExecutor,
	Transactor,
} from './types.ts';

/**
 * Create-once materialization of a schema's tables into Postgres: if they don't exist yet, generate
 * their CREATE DDL purely from the schema snapshot (drizzle-kit computes dialect-correct DDL — incl.
 * the `CREATE SCHEMA` for the namespace and FK ordering — without ever introspecting the live DB) and
 * apply it atomically. Never diffs against the database, so it cannot drop unrelated user tables.
 *
 * @param schema - A Drizzle schema module object (keyed table definitions).
 * @param raw - Runs a read query (used for the existence guard).
 * @param transaction - Runs the CREATE statements as one all-or-nothing unit.
 * @returns The CREATE statements applied (empty when the tables already existed).
 */
async function ensurePostgresSchema(
	schema: Record<string, unknown>,
	raw: RawExecutor,
	transaction: Transactor,
): Promise<string[]> {
	if (await postgresTablesExist(schema, raw)) return [];

	const { generateDrizzleJson, generateMigration } = await import('drizzle-kit/payload/postgres');
	const empty = await generateDrizzleJson({});
	const target = await generateDrizzleJson(withPgSchemas(schema));
	const statements = await generateMigration(empty, target);

	await transaction(async (run) => {
		// Sequential and in order: CREATE SCHEMA → CREATE TABLE → FK, on one connection.
		// eslint-disable-next-line no-await-in-loop
		for (const statement of statements) await run(statement);
	});
	return statements;
}

/**
 * Reports whether every Postgres table in `schema` already exists (the create-once guard). A partial
 * result (some but not all) returns `false`, so materialization retries and fails loud on the
 * conflicting CREATE rather than silently skipping.
 *
 * @param schema - The Drizzle schema module.
 * @param raw - Runs the introspection query.
 * @returns `true` when all of the schema's tables exist.
 */
async function postgresTablesExist(
	schema: Record<string, unknown>,
	raw: RawExecutor,
): Promise<boolean> {
	const identities = postgresTableIdentities(schema);
	if (identities.length === 0) return true;

	for (const { schema: schemaName, name } of identities) {
		// Sequential with early return on the first missing table.
		// eslint-disable-next-line no-await-in-loop
		const rows = await raw(
			`select 1 from information_schema.tables ` +
				`where table_schema = ${quoteLiteral(schemaName)} and table_name = ${quoteLiteral(name)} limit 1`,
		);
		if (rows.length === 0) return false;
	}
	return true;
}

/**
 * The `(schema, table)` identity of every Postgres table in a schema module (defaulting the namespace
 * to `public`), read from the tables themselves.
 *
 * @param schema - The Drizzle schema module.
 * @returns One identity per Postgres table.
 */
function postgresTableIdentities(
	schema: Record<string, unknown>,
): Array<{ schema: string; name: string }> {
	const identities: Array<{ schema: string; name: string }> = [];
	for (const value of Object.values(schema)) {
		if (!is(value, PgTable)) continue;
		const config = getTableConfig(value);
		identities.push({ schema: config.schema ?? 'public', name: config.name });
	}
	return identities;
}

/**
 * Returns the schema imports augmented with the `pgSchema` object(s) the tables live in, so drizzle-kit
 * emits `CREATE SCHEMA` for the namespace (it otherwise assumes the schema exists). Names are read from
 * the tables themselves, keeping the seam generic (no hard-coded namespace).
 *
 * @param schema - The Drizzle schema module (tables keyed by name).
 * @returns The imports plus a `pgSchema` entry per referenced non-default namespace.
 */
function withPgSchemas(schema: Record<string, unknown>): Record<string, unknown> {
	const imports: Record<string, unknown> = { ...schema };
	const schemaNames = new Set<string>();
	for (const value of Object.values(schema)) {
		if (!is(value, PgTable)) continue;
		const { schema: schemaName } = getTableConfig(value);
		if (schemaName) schemaNames.add(schemaName);
	}

	for (const name of schemaNames) imports[`__glaze_schema_${name}`] = pgSchema(name);
	return imports;
}

/**
 * Quotes a string as a SQL literal (single-quote escaped), for interpolating identifiers-as-values
 * into an introspection query.
 *
 * @param literal - The value to quote.
 * @returns The single-quoted, escaped literal.
 */
function quoteLiteral(literal: string): string {
	return `'${literal.replace(/'/g, "''")}'`;
}

/**
 * Opens a Postgres connection with `postgres.js` and wraps it in Drizzle.
 *
 * @param options - Must include a Postgres connection string.
 * @returns A live database handle.
 */
async function createDatabase(options: CreateDatabaseOptions): Promise<DatabaseHandle> {
	const client = postgres(options.connection);
	const db = drizzle({ client });

	const runRaw: RawExecutor = async (sql) => {
		const rows = await client.unsafe(sql);
		return rows as Array<Record<string, unknown>>;
	};

	const runTransaction: Transactor = async (fn) => {
		// postgres.js `begin` reserves one connection for the whole transaction and commits/rolls back
		// around the callback.
		const result = await client.begin(async (txClient) => {
			const tx: RawExecutor = async (sql) => {
				const rows = await txClient.unsafe(sql);
				return rows as Array<Record<string, unknown>>;
			};
			return fn(tx);
		});
		return result as Awaited<ReturnType<typeof fn>>;
	};

	return {
		db,
		raw: runRaw,
		transaction: runTransaction,
		// postgres.js reserves a connection for the duration, and Drizzle's transaction is correct on
		// this driver — unlike SQLite, where the seam has to bracket it by hand.
		queryTransaction: (fn) => db.transaction(fn),
		ensureSchema: (schema) => ensurePostgresSchema(schema, runRaw, runTransaction),
		async close() {
			await client.end();
		},
	};
}

/** The Postgres dialect adapter (postgres.js on Bun and Node). */
export const postgresDialect: DialectAdapter = {
	dialect: 'postgres',
	createDatabase,
	classifyConstraint: classifyPostgresConstraint,
};
