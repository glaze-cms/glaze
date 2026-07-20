import { matrixTest } from './matrix.ts';
import { expect } from './test-api.ts';

matrixTest('provisions a working database and round-trips a row', async ({ db }) => {
	const selected = await db.raw('select 1 as one');
	expect(selected[0]?.one).toBe(1);

	await db.raw('create table smoke (id integer primary key, label text)');
	await db.raw("insert into smoke (id, label) values (1, 'hello')");

	const rows = await db.raw('select label from smoke where id = 1');
	expect(rows).toHaveLength(1);
	expect(rows[0]?.label).toBe('hello');
});

matrixTest('gives every test an isolated database', async ({ db }) => {
	// If provisioning is isolated, the `smoke` table from the previous spec does not exist here,
	// so creating it must succeed and the table must start empty.
	await db.raw('create table smoke (id integer primary key)');
	const rows = await db.raw('select * from smoke');
	expect(rows).toHaveLength(0);
});
