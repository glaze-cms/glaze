import { getTableConfig as getPgTableConfig } from 'drizzle-orm/pg-core';
import { getTableConfig as getSqliteTableConfig } from 'drizzle-orm/sqlite-core';

import { expect, test } from '#harness';

import {
	AUTH_EXPECTED_COLUMNS,
	AUTH_PG_SCHEMA,
	AUTH_SQLITE_PREFIX,
	buildAuthSchema,
	type AuthModelName,
} from './schema.ts';

const MODELS: readonly AuthModelName[] = ['user', 'session', 'account', 'verification'];

/** The physical (plural) table name Glaze uses for each Better Auth model. */
const TABLE_NAMES: Record<AuthModelName, string> = {
	user: 'users',
	session: 'sessions',
	account: 'accounts',
	verification: 'verifications',
};

/** Sorted DB column names of a Drizzle table config (order-independent comparison). */
function sortedColumnNames(columns: ReadonlyArray<{ name: string }>): string[] {
	return columns.map((column) => column.name).toSorted();
}

test('postgres auth schema lives in the glaze_auth namespace with exactly Better Auth columns', () => {
	const schema = buildAuthSchema('postgres');

	for (const model of MODELS) {
		const config = getPgTableConfig(schema[model] as Parameters<typeof getPgTableConfig>[0]);
		expect(config.schema).toBe(AUTH_PG_SCHEMA);
		expect(config.name).toBe(TABLE_NAMES[model]);
		expect(sortedColumnNames(config.columns)).toEqual([...AUTH_EXPECTED_COLUMNS[model]].toSorted());
	}
});

test('sqlite auth schema uses the zz__glaze_auth_ prefix with exactly Better Auth columns', () => {
	const schema = buildAuthSchema('sqlite');

	for (const model of MODELS) {
		const config = getSqliteTableConfig(
			schema[model] as Parameters<typeof getSqliteTableConfig>[0],
		);
		expect(config.name).toBe(`${AUTH_SQLITE_PREFIX}${TABLE_NAMES[model]}`);
		expect(sortedColumnNames(config.columns)).toEqual([...AUTH_EXPECTED_COLUMNS[model]].toSorted());
	}
});

test('no RBAC leaked in: the user table carries no role column on either dialect', () => {
	const pgColumns = sortedColumnNames(
		getPgTableConfig(buildAuthSchema('postgres').user as Parameters<typeof getPgTableConfig>[0])
			.columns,
	);
	const sqliteColumns = sortedColumnNames(
		getSqliteTableConfig(
			buildAuthSchema('sqlite').user as Parameters<typeof getSqliteTableConfig>[0],
		).columns,
	);
	expect(pgColumns.includes('role')).toBe(false);
	expect(sqliteColumns.includes('role')).toBe(false);
});
