import { pgTable, text } from 'drizzle-orm/pg-core';
import { sqliteTable, text as sqliteText } from 'drizzle-orm/sqlite-core';

import { expect, matrixTest } from '#harness';

import type { DatabaseHandle, Dialect } from './types.ts';
import type { Table } from 'drizzle-orm';

// `queryTransaction` exists because Drizzle's own `db.transaction` is not a transaction on SQLite:
// both drivers wrap a *synchronous* function, so `COMMIT` runs the moment an async callback awaits and
// every statement after it commits on its own. These assert the property that matters — a throw leaves
// nothing behind — against the real driver on each dialect, on whichever runtime is running.

/** The slice of the Drizzle builder these tests drive, the same cast feature code uses. */
interface Builder {
	insert(table: Table): { values(row: Record<string, unknown>): PromiseLike<unknown> };
}

/** A one-column probe table, built for the dialect under test. */
function probeTable(dialect: Dialect): Table {
	return dialect === 'postgres'
		? pgTable('tx_probe', { id: text('id').primaryKey() })
		: sqliteTable('tx_probe', { id: sqliteText('id').primaryKey() });
}

/** Creates the probe table with raw SQL, so no schema module is needed. */
async function createProbeTable(db: DatabaseHandle): Promise<void> {
	await db.raw('create table tx_probe (id text primary key)');
}

/** Counts the rows in the probe table. */
async function countRows(db: DatabaseHandle): Promise<number> {
	return (await db.raw('select id from tx_probe')).length;
}

matrixTest('a throwing query transaction leaves nothing behind', async ({ db, dialect }) => {
	await createProbeTable(db);
	const table = probeTable(dialect);

	let threw = false;
	try {
		await db.queryTransaction(async (tx) => {
			await (tx as Builder).insert(table).values({ id: 'a' });
			// This await is what breaks Drizzle's SQLite transaction: it commits here, so the row above
			// survives the throw below. The seam's own bracket covers it.
			throw new Error('abort');
		});
	} catch {
		threw = true;
	}

	expect(threw).toBe(true);
	expect(await countRows(db)).toBe(0);
});

matrixTest('a query transaction that returns commits its work', async ({ db, dialect }) => {
	await createProbeTable(db);
	const table = probeTable(dialect);

	const returned = await db.queryTransaction(async (tx) => {
		await (tx as Builder).insert(table).values({ id: 'a' });
		await (tx as Builder).insert(table).values({ id: 'b' });
		return 'done';
	});

	expect(returned).toBe('done');
	expect(await countRows(db)).toBe(2);
});

// A transaction that half-commits is worse than none, because the caller believes it. Both statements
// land or neither does.
matrixTest('a failing statement rolls back the ones before it', async ({ db, dialect }) => {
	await createProbeTable(db);
	const table = probeTable(dialect);
	await db.raw("insert into tx_probe (id) values ('taken')");

	try {
		await db.queryTransaction(async (tx) => {
			await (tx as Builder).insert(table).values({ id: 'first' });
			// Duplicate primary key: the database refuses this one.
			await (tx as Builder).insert(table).values({ id: 'taken' });
		});
	} catch {
		/* expected */
	}

	// Only the pre-existing row survives; `first` went back with the failure.
	expect(await countRows(db)).toBe(1);
});
