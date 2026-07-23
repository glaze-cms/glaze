import { resolveConfig } from '#config';
import { expect, matrixTest } from '#harness';
import { createLogger } from '#logger';
import { resolveRuntime } from '#runtime';

import { resolveOptions } from '../options/index.ts';
import { materializeAuthTables } from './materializer.ts';

import type { DatabaseHandle, Dialect } from '#dialect';
import type { GlazeContext } from '../app/context.ts';

/** Builds a Glaze context around a live harness database for the materializer to run against. */
function buildContext(db: DatabaseHandle, dialect: Dialect): GlazeContext {
	return {
		db,
		config: resolveConfig({ dialect, connection: 'unused' }),
		options: resolveOptions({}),
		logger: createLogger({ level: 'silent' }),
		runtime: resolveRuntime(),
	};
}

/** Lists the materialized auth tables from the live database, by dialect namespace. */
async function authTableNames(db: DatabaseHandle, dialect: Dialect): Promise<string[]> {
	if (dialect === 'postgres') {
		const rows = await db.raw(
			"select table_name from information_schema.tables where table_schema = 'glaze_auth' order by table_name",
		);
		return rows.map((row) => String(row['table_name']));
	}
	const rows = await db.raw(
		"select name from sqlite_master where type = 'table' and name like 'zz__glaze_auth_%' order by name",
	);
	return rows.map((row) => String(row['name']));
}

matrixTest(
	'materializes the four auth tables in the internal namespace',
	async ({ db, dialect }) => {
		await materializeAuthTables(buildContext(db, dialect));

		const expected =
			dialect === 'postgres'
				? ['accounts', 'sessions', 'users', 'verifications']
				: [
						'zz__glaze_auth_accounts',
						'zz__glaze_auth_sessions',
						'zz__glaze_auth_users',
						'zz__glaze_auth_verifications',
					];
		expect(await authTableNames(db, dialect)).toEqual(expected);
	},
);

matrixTest(
	're-materializing is idempotent (no error, no duplicate tables)',
	async ({ db, dialect }) => {
		const context = buildContext(db, dialect);
		await materializeAuthTables(context);
		await materializeAuthTables(context);
		expect(await authTableNames(db, dialect)).toHaveLength(4);
	},
);

// Materialization only ever ADDS its own tables; it must never diff against the live database, which
// would drop unrelated user tables.
matrixTest('never drops unrelated user tables on re-materialization', async ({ db, dialect }) => {
	const context = buildContext(db, dialect);
	await materializeAuthTables(context);

	await db.raw('create table user_content (id integer primary key, title text)');
	await db.raw("insert into user_content (id, title) values (1, 'keep me')");

	// A second boot (re-materialize) must leave user content untouched.
	await materializeAuthTables(context);

	const rows = await db.raw('select title from user_content');
	expect(rows).toHaveLength(1);
	expect(String(rows[0]?.['title'])).toBe('keep me');
});
