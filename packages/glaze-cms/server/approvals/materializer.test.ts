import { resolveConfig } from '#config';
import { expect, matrixTest } from '#harness';
import { createLogger } from '#logger';
import { resolveRuntime } from '#runtime';

import { resolveOptions } from '../options/index.ts';
import { materializeApprovalTables } from './materializer.ts';

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

/** Lists the materialized approvals tables from the live database, by dialect namespace. */
async function approvalTableNames(db: DatabaseHandle, dialect: Dialect): Promise<string[]> {
	if (dialect === 'postgres') {
		const rows = await db.raw(
			"select table_name from information_schema.tables where table_schema = 'glaze' order by table_name",
		);
		return rows.map((row) => String(row['table_name']));
	}
	// `like 'zz__glaze_%'` would also match the auth tables, which carry the longer `zz__glaze_auth_`
	// prefix, so exclude them explicitly.
	const rows = await db.raw(
		"select name from sqlite_master where type = 'table' " +
			"and name like 'zz__glaze_%' and name not like 'zz__glaze_auth_%' order by name",
	);
	return rows.map((row) => String(row['name']));
}

/** The DB-qualified approval-events table for the dialect. */
function eventsTable(dialect: Dialect): string {
	return dialect === 'postgres' ? 'glaze.approval_events' : 'zz__glaze_approval_events';
}

matrixTest(
	'materializes the approvals tables in the internal namespace',
	async ({ db, dialect }) => {
		await materializeApprovalTables(buildContext(db, dialect));

		const expected =
			dialect === 'postgres'
				? ['approval_events', 'principals']
				: ['zz__glaze_approval_events', 'zz__glaze_principals'];
		expect(await approvalTableNames(db, dialect)).toEqual(expected);
	},
);

matrixTest(
	're-materializing is idempotent (no error, no duplicate tables)',
	async ({ db, dialect }) => {
		const context = buildContext(db, dialect);
		await materializeApprovalTables(context);
		await materializeApprovalTables(context);
		expect(await approvalTableNames(db, dialect)).toHaveLength(2);
	},
);

// Materialization only ever ADDS its own tables; it must never diff against the live database, which
// would drop unrelated user tables.
matrixTest('never drops unrelated user tables on re-materialization', async ({ db, dialect }) => {
	const context = buildContext(db, dialect);
	await materializeApprovalTables(context);

	await db.raw('create table user_content (id integer primary key, title text)');
	await db.raw("insert into user_content (id, title) values (1, 'keep me')");

	await materializeApprovalTables(context);

	const rows = await db.raw('select title from user_content');
	expect(rows).toHaveLength(1);
	expect(String(rows[0]?.['title'])).toBe('keep me');
});

// The trail records who acted, and `system` events record that nobody did. Storing an event without an
// actor must be possible, or Glaze cannot record its own supersede/withdraw.
matrixTest(
	'accepts an event with no actor, and rejects one with no kind',
	async ({ db, dialect }) => {
		await materializeApprovalTables(buildContext(db, dialect));

		const now = dialect === 'postgres' ? "'1970-01-01'" : '0';
		await db.raw(
			`insert into ${eventsTable(dialect)} (id, request_id, type, actor_kind, created_at) ` +
				`values ('e1', 'r1', 'superseded', 'system', ${now})`,
		);
		expect(await db.raw(`select id from ${eventsTable(dialect)}`)).toHaveLength(1);

		let rejected = false;
		try {
			await db.raw(
				`insert into ${eventsTable(dialect)} (id, request_id, type, created_at) ` +
					`values ('e2', 'r1', 'approved', ${now})`,
			);
		} catch {
			rejected = true;
		}
		expect(rejected).toBe(true);
	},
);

// One principal per account: a second role row for the same user would make "what may they do"
// answerable two ways, and the request path would pick whichever the planner returned first.
matrixTest('the database rejects a second role row for one account', async ({ db, dialect }) => {
	await materializeApprovalTables(buildContext(db, dialect));

	const now = dialect === 'postgres' ? "'1970-01-01'" : '0';
	const principals = dialect === 'postgres' ? 'glaze.principals' : 'zz__glaze_principals';
	await db.raw(
		`insert into ${principals} (user_id, role, created_at) values ('u1', 'admin', ${now})`,
	);

	let rejected = false;
	try {
		await db.raw(
			`insert into ${principals} (user_id, role, created_at) values ('u1', 'editor', ${now})`,
		);
	} catch {
		rejected = true;
	}
	expect(rejected).toBe(true);
});
