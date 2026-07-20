import { expect, matrixTest } from '../../harness/index.ts';
import { applyMigration } from './index.ts';

matrixTest('applies schema DDL atomically and preserves rows', async ({ db, dialect }) => {
	await db.raw('create table t (id integer primary key, name text)');
	await db.raw("insert into t (id, name) values (1, 'a')");
	await db.raw("insert into t (id, name) values (2, 'b')");

	const result = await applyMigration(db, {
		dialect,
		statements: ['alter table t add column note text'],
	});

	expect(result.success).toBe(true);
	if (result.success) expect(result.appliedCount).toBe(1);

	// Committed: the new column exists and both rows are intact.
	const rows = await db.raw('select id, note from t');
	expect(rows).toHaveLength(2);
});

matrixTest('rolls back and names the failing statement', async ({ db, dialect }) => {
	await db.raw('create table t (id integer primary key)');
	await db.raw('insert into t (id) values (1)');

	const result = await applyMigration(db, {
		dialect,
		statements: ['alter table t add column ok text', 'this is not valid sql'],
	});

	expect(result.success).toBe(false);
	if (result.success || result.reason !== 'statement_error') {
		throw new Error('expected a statement_error result');
	}
	expect(result.failedStatement).toBe('this is not valid sql');

	// Rolled back: the first statement's column must not exist.
	let columnExists = true;
	try {
		await db.raw('select ok from t');
	} catch {
		columnExists = false;
	}
	expect(columnExists).toBe(false);
});

matrixTest(
	'detects unexpected row loss in a surviving table and rolls back',
	async ({ db, dialect }) => {
		await db.raw('create table t (id integer primary key)');
		await db.raw('insert into t (id) values (1)');
		await db.raw('insert into t (id) values (2)');

		const result = await applyMigration(db, {
			dialect,
			statements: ['delete from t where id = 1'],
		});

		expect(result.success).toBe(false);
		if (result.success || result.reason !== 'unexpected_data_loss') {
			throw new Error('expected an unexpected_data_loss result');
		}
		expect(result.losses).toHaveLength(1);
		expect(result.losses[0]?.table).toBe('t');
		expect(result.losses[0]?.before).toBe(2);
		expect(result.losses[0]?.after).toBe(1);

		// Rolled back: both rows are still present.
		const rows = await db.raw('select id from t');
		expect(rows).toHaveLength(2);
	},
);

matrixTest(
	'flags an unapproved table drop as data loss and rolls back',
	async ({ db, dialect }) => {
		await db.raw('create table t (id integer primary key)');
		await db.raw('insert into t (id) values (1)');

		const result = await applyMigration(db, {
			dialect,
			statements: ['drop table t'], // droppedTables intentionally omitted
		});

		expect(result.success).toBe(false);
		if (result.success || result.reason !== 'unexpected_data_loss') {
			throw new Error('expected an unexpected_data_loss result');
		}
		expect(result.losses[0]?.table).toBe('t');

		// Rolled back: the table and its row survive.
		const rows = await db.raw('select id from t');
		expect(rows).toHaveLength(1);
	},
);

matrixTest('allows an intentional table drop', async ({ db, dialect }) => {
	await db.raw('create table keep (id integer primary key)');
	await db.raw('insert into keep (id) values (1)');
	await db.raw('create table gone (id integer primary key)');
	await db.raw('insert into gone (id) values (1)');

	const result = await applyMigration(db, {
		dialect,
		statements: ['drop table gone'],
		droppedTables: ['gone'],
	});

	expect(result.success).toBe(true);

	// `keep` is intact; `gone` is dropped.
	expect(await db.raw('select id from keep')).toHaveLength(1);
	let goneExists = true;
	try {
		await db.raw('select id from gone');
	} catch {
		goneExists = false;
	}
	expect(goneExists).toBe(false);
});

matrixTest('matches a renamed table so the rename is not a false loss', async ({ db, dialect }) => {
	await db.raw('create table old_name (id integer primary key)');
	await db.raw('insert into old_name (id) values (1)');
	await db.raw('insert into old_name (id) values (2)');

	const result = await applyMigration(db, {
		dialect,
		statements: ['alter table old_name rename to new_name'],
		renamedTables: [{ from: 'old_name', to: 'new_name' }],
	});

	expect(result.success).toBe(true);
	expect(await db.raw('select id from new_name')).toHaveLength(2);
});

matrixTest('resolves a rename chain (a→b→c) without a false loss', async ({ db, dialect }) => {
	await db.raw('create table old_t (id integer primary key)');
	await db.raw('insert into old_t (id) values (1)');
	await db.raw('insert into old_t (id) values (2)');

	const result = await applyMigration(db, {
		dialect,
		statements: ['alter table old_t rename to mid_t', 'alter table mid_t rename to new_t'],
		renamedTables: [
			{ from: 'old_t', to: 'mid_t' },
			{ from: 'mid_t', to: 'new_t' },
		],
	});

	expect(result.success).toBe(true);
	expect(await db.raw('select id from new_t')).toHaveLength(2);
});

matrixTest(
	'rejects a transaction-control statement to protect atomicity',
	async ({ db, dialect }) => {
		await db.raw('create table t (id integer primary key)');
		await db.raw('insert into t (id) values (1)');

		const result = await applyMigration(db, {
			dialect,
			statements: ['alter table t add column x text', 'commit', 'drop table t'],
		});

		expect(result.success).toBe(false);
		if (result.success || result.reason !== 'statement_error') {
			throw new Error('expected a statement_error result');
		}
		expect(result.failedStatement).toBe('commit');

		// Rolled back: the table and its row survive, and the added column is gone.
		expect(await db.raw('select id from t')).toHaveLength(1);
		let columnExists = true;
		try {
			await db.raw('select x from t');
		} catch {
			columnExists = false;
		}
		expect(columnExists).toBe(false);
	},
);
