import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, matrixTest, nextSecond } from '../../harness/index.ts';
import { converge } from './index.ts';

import type { DatabaseHandle, Dialect } from '../../dialect/index.ts';
import type { ConvergeOptions, DecisionResolution, Resolver } from './index.ts';

// End-to-end: the REAL generate (file) + the REAL apply oracle (DB from the harness), tied by the
// facade. drizzle computes; Glaze applies and guards. The human seams are deterministic stubs.

/** The package root — fixtures must live here so their `drizzle-orm` import resolves. */
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

/** A resolver used where no decision should arise; if one does, it defaults to `create`. */
const asCreate = (): DecisionResolution => ({ action: 'create' });

/**
 * Builds a schema module for a dialect: `{ table: [columns] }`. A bare name is a nullable text column,
 * `id` is the integer primary key, and `name: <declaration>` is used verbatim (with `integer`, `text`
 * and `numeric` in scope) for anything else.
 */
function schemaModule(dialect: Dialect, tables: Record<string, readonly string[]>): string {
	const core = dialect === 'postgres' ? 'pg-core' : 'sqlite-core';
	const tableFn = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
	const decls = Object.entries(tables)
		.map(([name, columns]) => {
			const cols = columns
				.map((c) => {
					if (c.includes(':')) return c;
					return c === 'id' ? `id: integer('id').primaryKey()` : `${c}: text('${c}')`;
				})
				.join(', ');
			return `export const ${name} = ${tableFn}('${name}', { ${cols} });`;
		})
		.join('\n');
	return `import { ${tableFn}, integer, numeric, text, uniqueIndex } from 'drizzle-orm/${core}';\n${decls}\n`;
}

/**
 * Writes a raw schema module (the caller supplies the whole file) and converges it, so a test can
 * declare things the `{ table: [columns] }` shorthand cannot — another Postgres schema, an index.
 */
async function convergeRaw(
	db: DatabaseHandle,
	dialect: Dialect,
	dir: string,
	out: string,
	name: string,
	source: string,
	extra: Partial<
		Pick<
			ConvergeOptions,
			'confirmLoss' | 'confirmDrop' | 'confirmUnclassified' | 'audit' | 'resolve'
		>
	> = {},
) {
	const schema = join(dir, `${name}.ts`);
	writeFileSync(schema, source);
	return converge({ db, dialect, schema, out, resolve: asCreate, ...extra });
}

/** A schema module with one table whose `column` may carry a unique index (always named `t_uidx`). */
function uniqueIndexModule(dialect: Dialect, withIndex: boolean, column = 'email'): string {
	const core = dialect === 'postgres' ? 'pg-core' : 'sqlite-core';
	const tableFn = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
	const index = withIndex ? `, (t) => [uniqueIndex('t_uidx').on(t.${column})]` : '';
	return (
		`import { ${tableFn}, integer, text, uniqueIndex } from 'drizzle-orm/${core}';\n` +
		`export const t = ${tableFn}('t', { id: integer('id').primaryKey(), ${column}: text('${column}') }${index});\n`
	);
}

/** A temp project dir under the package (so fixtures' `drizzle-orm` import resolves). */
function tempProject(): { dir: string; out: string; cleanup: () => void } {
	const dir = join(packageRoot, `.tmp-converge-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return {
		dir,
		out: join(dir, 'migrations'),
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

/** Runs converge for a freshly-written schema file (a new path avoids the module cache). */
async function convergeSchema(
	db: DatabaseHandle,
	dialect: Dialect,
	dir: string,
	out: string,
	name: string,
	tables: Record<string, readonly string[]>,
	extra: Partial<
		Pick<
			ConvergeOptions,
			'confirmLoss' | 'confirmDrop' | 'confirmUnclassified' | 'audit' | 'resolve'
		>
	> = {},
) {
	const schema = join(dir, `${name}.ts`);
	writeFileSync(schema, schemaModule(dialect, tables));
	return converge({ db, dialect, schema, out, resolve: asCreate, ...extra });
}

/** A resolver that answers every rename-or-create with "it is a rename of `oldName`". */
function renamingFrom(oldName: string): Resolver {
	return (decision) =>
		decision.type === 'rename_or_create'
			? { action: 'rename', from: [...decision.target.slice(0, -1), oldName] }
			: { action: 'confirm' };
}

/** A column whose type change has no classifier rule on this dialect, before and after. */
function unclassifiedTypeChange(dialect: Dialect): { before: string; after: string } {
	return dialect === 'postgres'
		? {
				before: `price: numeric('price', { precision: 10, scale: 4 })`,
				after: `price: numeric('price', { precision: 10, scale: 2 })`,
			}
		: { before: `price: text('price')`, after: `price: integer('price')` };
}

/** A seam that must not be reached: reaching it fails the test loudly. */
const neverAsked = (): never => {
	throw new Error('this seam must not be asked');
};

/** Whether a table is queryable (exists) in the live database. */
async function tableExists(db: DatabaseHandle, table: string): Promise<boolean> {
	try {
		await db.raw(`select * from ${table}`);
		return true;
	} catch {
		return false;
	}
}

matrixTest(
	'converge creates a table, then adds a column, preserving rows',
	async ({ db, dialect }) => {
		const p = tempProject();
		try {
			const created = await convergeSchema(db, dialect, p.dir, p.out, 'a', {
				users: ['id', 'nickname'],
			});
			expect(created.status).toBe('applied');

			await db.raw("insert into users (id, nickname) values (1, 'nick')");

			const added = await convergeSchema(db, dialect, p.dir, p.out, 'b', {
				users: ['id', 'nickname', 'email'],
			});
			expect(added.status).toBe('applied');

			const rows = await db.raw('select id, nickname, email from users');
			expect(rows).toHaveLength(1);
		} finally {
			p.cleanup();
		}
	},
);

// Additive changes apply under audit: nothing is at stake, so nobody is asked.
matrixTest(
	'under audit, an additive change applies without asking anybody',
	async ({ db, dialect }) => {
		const p = tempProject();
		try {
			const created = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'a',
				{ widgets: ['id', 'label'] },
				{ audit: true },
			);
			expect(created.status).toBe('applied');
			await db.raw("insert into widgets (id, label) values (1, 'w')");

			const widened = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'b',
				{ widgets: ['id', 'label', 'note'] },
				{ audit: true },
			);
			expect(widened.status).toBe('applied');
			expect(await db.raw('select id, label, note from widgets')).toHaveLength(1);
		} finally {
			p.cleanup();
		}
	},
);

matrixTest(
	'under audit, a populated column drop is pending with its count, and never desyncs',
	async ({ db, dialect }) => {
		const p = tempProject();
		try {
			await convergeSchema(db, dialect, p.dir, p.out, 'a', { people: ['id', 'email'] });
			await db.raw("insert into people (id, email) values (1, 'a@b.c')");

			const pending = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'b',
				{ people: ['id'] },
				{ audit: true },
			);
			expect(pending.status).toBe('pending');
			if (pending.status !== 'pending') return;
			expect(pending.findings.map((finding) => [finding.code, finding.affectedRows])).toEqual([
				['column_has_data', 1],
			]);
			expect(pending.unclassified).toEqual([]);
			expect(pending.changeHash).toHaveLength(64);
			expect(await db.raw('select email from people')).toHaveLength(1);

			// No snapshot desync: audit rolled the migration back, so a later converge still sees the
			// change and can apply it (rather than reporting a false `no_changes`).
			const applied = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'c',
				{ people: ['id'] },
				{ confirmDrop: () => true },
			);
			expect(applied.status).toBe('applied');
		} finally {
			p.cleanup();
		}
	},
);

// The table drop that once slipped through: it is decided before anything runs, on both paths.
matrixTest(
	'a populated table drop is pending under audit, and applies when empty',
	async ({ db, dialect }) => {
		const p = tempProject();
		try {
			await convergeSchema(db, dialect, p.dir, p.out, 'a', {
				keep: ['id'],
				gone: ['id'],
				empty: ['id'],
			});
			await db.raw('insert into gone (id) values (1)');

			const pending = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'b',
				{ keep: ['id'], empty: ['id'] },
				{ audit: true, confirmLoss: neverAsked },
			);
			expect(pending.status).toBe('pending');
			if (pending.status !== 'pending') return;
			expect(pending.findings.map((finding) => [finding.code, finding.affectedRows])).toEqual([
				['table_has_rows', 1],
			]);
			expect(await db.raw('select id from gone')).toHaveLength(1);

			// Dropping the empty table destroys nothing: it applies, audited, with nobody asked.
			const applied = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'c',
				{ keep: ['id'], gone: ['id'] },
				{ audit: true, confirmLoss: neverAsked },
			);
			expect(applied.status).toBe('applied');
			expect(await tableExists(db, 'empty')).toBe(false);
			expect(await tableExists(db, 'gone')).toBe(true);
		} finally {
			p.cleanup();
		}
	},
);

// The type change that once slipped through: no rule means pending, not applied.
matrixTest(
	'a type change with no rule is unclassified: pending under audit, asked at a terminal',
	async ({ db, dialect }) => {
		const p = tempProject();
		const { before, after } = unclassifiedTypeChange(dialect);
		try {
			await convergeSchema(db, dialect, p.dir, p.out, 'a', { items: ['id', before] });
			await db.raw("insert into items (id, price) values (1, '12.3456')");

			const pending = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'b',
				{ items: ['id', after] },
				{ audit: true },
			);
			expect(pending.status).toBe('pending');
			if (pending.status !== 'pending') return;
			expect(pending.findings).toEqual([]);
			expect(pending.unclassified.map((op) => [op.op, op.table, op.name, op.changed])).toEqual([
				['alter', 'items', 'price', ['type']],
			]);
			expect(String((await db.raw('select price from items'))[0]?.['price'])).toBe('12.3456');

			// At a terminal, declining leaves everything as it was.
			const declined = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'c',
				{ items: ['id', after] },
				{ confirmUnclassified: () => false },
			);
			expect(declined.status).toBe('unclassified_change');
			expect(String((await db.raw('select price from items'))[0]?.['price'])).toBe('12.3456');

			// Accepting applies it.
			const applied = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'd',
				{ items: ['id', after] },
				{ confirmUnclassified: () => true },
			);
			expect(applied.status).toBe('applied');
		} finally {
			p.cleanup();
		}
	},
);

// The rename-beside-a-drop that once slipped through: the drop is still seen, under the new name.
matrixTest(
	'a column dropped beside a table rename is pending under audit',
	async ({ db, dialect }) => {
		const p = tempProject();
		try {
			await convergeSchema(db, dialect, p.dir, p.out, 'a', { users: ['id', 'email'] });
			await db.raw("insert into users (id, email) values (1, 'a@b.c')");

			const pending = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'b',
				{ people: ['id'] },
				{ audit: true, resolve: renamingFrom('users') },
			);
			expect(pending.status).toBe('pending');
			if (pending.status !== 'pending') return;
			// Measured under the live table name: the database has not been renamed yet.
			expect(pending.findings.map((finding) => [finding.change, finding.affectedRows])).toEqual([
				[
					{
						kind: 'drop_column',
						...(dialect === 'postgres' ? { schema: 'public' } : {}),
						table: 'users',
						column: 'email',
					},
					1,
				],
			]);
			expect(pending.unclassified).toEqual([]);
			expect(await db.raw('select email from users')).toHaveLength(1);
		} finally {
			p.cleanup();
		}
	},
);

matrixTest(
	'converge blocks a populated column drop, then applies it once confirmed',
	async ({ db, dialect }) => {
		const p = tempProject();
		try {
			const setup = await convergeSchema(db, dialect, p.dir, p.out, 'a', {
				people: ['id', 'email'],
			});
			expect(setup.status).toBe('applied');
			await db.raw("insert into people (id, email) values (1, 'a@b.c')");

			// No confirmer ⇒ the drop of a populated column is declined; the column and its data survive.
			const blocked = await convergeSchema(db, dialect, p.dir, p.out, 'b', { people: ['id'] });
			expect(blocked.status).toBe('drop_declined');
			expect(await db.raw('select email from people')).toHaveLength(1);

			// Confirming applies the drop: the row survives, the column is gone.
			const applied = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'c',
				{ people: ['id'] },
				{ confirmDrop: () => true },
			);
			expect(applied.status).toBe('applied');
			expect(await db.raw('select id from people')).toHaveLength(1);
			expect(await tableExists(db, 'people')).toBe(true);

			let emailExists = true;
			try {
				await db.raw('select email from people');
			} catch {
				emailExists = false;
			}
			expect(emailExists).toBe(false);
		} finally {
			p.cleanup();
		}
	},
);

matrixTest(
	'converge applies a drop of a column with no data without a confirmer',
	async ({ db, dialect }) => {
		const p = tempProject();
		try {
			await convergeSchema(db, dialect, p.dir, p.out, 'a', { widgets: ['id', 'note'] });
			// A row exists but `note` stays NULL, so dropping it destroys nothing → no confirmation needed.
			await db.raw('insert into widgets (id) values (1)');

			const applied = await convergeSchema(db, dialect, p.dir, p.out, 'b', { widgets: ['id'] });
			expect(applied.status).toBe('applied');
			expect(await db.raw('select id from widgets')).toHaveLength(1);
		} finally {
			p.cleanup();
		}
	},
);

matrixTest('converge is a no-op when the schema already matches', async ({ db, dialect }) => {
	const p = tempProject();
	try {
		await convergeSchema(db, dialect, p.dir, p.out, 'a', { users: ['id'] });
		const again = await convergeSchema(db, dialect, p.dir, p.out, 'a-again', { users: ['id'] });
		expect(again.status).toBe('no_changes');
	} finally {
		p.cleanup();
	}
});

matrixTest(
	'converge declines a populated-table drop, then applies it once confirmed, asking once',
	async ({ db, dialect }) => {
		const p = tempProject();
		try {
			const setup = await convergeSchema(db, dialect, p.dir, p.out, 'a', {
				keep: ['id'],
				gone: ['id'],
			});
			expect(setup.status).toBe('applied');
			await db.raw('insert into keep (id) values (1)');
			await db.raw('insert into gone (id) values (1)');

			// The drop is decided before anything runs, from the measured count. Declining leaves the
			// table — and rolls the snapshot back, so the same drop can be re-proposed.
			const declined = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'b',
				{ keep: ['id'] },
				{ confirmDrop: () => false, confirmLoss: neverAsked },
			);
			expect(declined.status).toBe('drop_declined');
			expect(await db.raw('select id from gone')).toHaveLength(1);

			// Confirming applies the drop. The apply oracle verifies it rather than asking again.
			const confirmed = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'c',
				{ keep: ['id'] },
				{ confirmDrop: () => true, confirmLoss: neverAsked },
			);
			expect(confirmed.status).toBe('applied');
			expect(await db.raw('select id from keep')).toHaveLength(1);

			let goneExists = true;
			try {
				await db.raw('select id from gone');
			} catch {
				goneExists = false;
			}
			expect(goneExists).toBe(false);
		} finally {
			p.cleanup();
		}
	},
);

matrixTest(
	'converge returns a typed error (not an unhandled rejection) when a confirmer throws',
	async ({ db, dialect }) => {
		const p = tempProject();
		try {
			await convergeSchema(db, dialect, p.dir, p.out, 'a', { people: ['id', 'bio'] });
			await db.raw("insert into people (id, bio) values (1, 'hi')");

			// A confirmer that throws (e.g. a dropped socket to the admin UI) must become a typed error
			// with the migration swept — never a leaked snapshot sitting ahead of the DB.
			const errored = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'b',
				{ people: ['id'] },
				{
					confirmDrop: () => {
						throw new Error('confirmer boom');
					},
				},
			);
			expect(errored.status).toBe('error');
			expect(await db.raw('select bio from people')).toHaveLength(1);

			// The snapshot was rolled back, so a subsequent converge still sees — and can apply — the drop.
			const applied = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'c',
				{ people: ['id'] },
				{ confirmDrop: () => true },
			);
			expect(applied.status).toBe('applied');
		} finally {
			p.cleanup();
		}
	},
);

// A same-named table in `public` must never be measured in place of the one being dropped.
matrixTest(
	'a populated table in another Postgres schema is measured there, not in public',
	async ({ db, dialect }) => {
		if (dialect !== 'postgres') return;
		const p = tempProject();
		const both =
			`import { pgSchema, pgTable, integer } from 'drizzle-orm/pg-core';\n` +
			`export const shop = pgSchema('shop');\n` +
			`export const shopOrders = shop.table('orders', { id: integer('id').primaryKey() });\n` +
			`export const orders = pgTable('orders', { id: integer('id').primaryKey() });\n`;
		const publicOnly =
			`import { pgSchema, pgTable, integer } from 'drizzle-orm/pg-core';\n` +
			`export const shop = pgSchema('shop');\n` +
			`export const orders = pgTable('orders', { id: integer('id').primaryKey() });\n`;
		try {
			expect((await convergeRaw(db, dialect, p.dir, p.out, 'a', both)).status).toBe('applied');
			await db.raw('insert into shop.orders (id) values (1), (2), (3)');

			const pending = await convergeRaw(db, dialect, p.dir, p.out, 'b', publicOnly, {
				audit: true,
				confirmLoss: neverAsked,
			});
			expect(pending.status).toBe('pending');
			if (pending.status !== 'pending') return;
			expect(pending.findings.map((finding) => [finding.change, finding.affectedRows])).toEqual([
				[{ kind: 'drop_table', schema: 'shop', table: 'orders' }, 3],
			]);
			expect(await db.raw('select id from shop.orders')).toHaveLength(3);
		} finally {
			p.cleanup();
		}
	},
);

// A unique over a column that arrives in the same change has nothing to be duplicated: it applies.
matrixTest('a new unique column on a populated table applies', async ({ db, dialect }) => {
	const p = tempProject();
	try {
		await convergeSchema(db, dialect, p.dir, p.out, 'a', { t: ['id', 'a'] });
		await db.raw("insert into t (id, a) values (1, 'x'), (2, 'x')");

		const applied = await convergeSchema(
			db,
			dialect,
			p.dir,
			p.out,
			'b',
			{ t: ['id', 'a', `email: text('email').unique()`] },
			{ audit: true },
		);
		expect(applied.status).toBe('applied');
		expect(await db.raw('select id, a, email from t')).toHaveLength(2);
	} finally {
		p.cleanup();
	}
});

// A unique index over duplicates is impossible, not pending: nobody can approve it into working.
matrixTest('a unique index over existing duplicates fails closed', async ({ db, dialect }) => {
	const p = tempProject();
	try {
		expect(
			(await convergeRaw(db, dialect, p.dir, p.out, 'a', uniqueIndexModule(dialect, false))).status,
		).toBe('applied');
		await db.raw("insert into t (id, email) values (1, 'a@b.c'), (2, 'a@b.c')");

		const blocked = await convergeRaw(
			db,
			dialect,
			p.dir,
			p.out,
			'b',
			uniqueIndexModule(dialect, true),
			{
				audit: true,
			},
		);
		expect(blocked.status).toBe('unsafe_change');
		if (blocked.status !== 'unsafe_change') return;
		expect(blocked.findings.map((finding) => [finding.code, finding.affectedRows])).toEqual([
			['unique_duplicates', 1],
		]);
	} finally {
		p.cleanup();
	}
});

// A rename that only renames — even under a unique index — has nothing for anybody to decide.
matrixTest(
	'renaming a column under a unique index applies under audit',
	async ({ db, dialect }) => {
		const p = tempProject();
		const renamedModule = uniqueIndexModule(dialect, true, 'mail');
		try {
			await convergeRaw(db, dialect, p.dir, p.out, 'a', uniqueIndexModule(dialect, true));
			await db.raw("insert into t (id, email) values (1, 'a@b.c')");

			const applied = await convergeRaw(db, dialect, p.dir, p.out, 'b', renamedModule, {
				audit: true,
				resolve: renamingFrom('email'),
			});
			expect(applied.status).toBe('applied');
			expect(String((await db.raw('select mail from t'))[0]?.['mail'])).toBe('a@b.c');
		} finally {
			p.cleanup();
		}
	},
);

// The apply oracle counts `public` only and knows tables by bare name. A rename elsewhere must not
// reach it, or a same-named public table reads as having vanished.
matrixTest(
	'renaming a table in another Postgres schema does not disturb a same-named public table',
	async ({ db, dialect }) => {
		if (dialect !== 'postgres') return;
		const p = tempProject();
		const head =
			`import { pgSchema, pgTable, integer, text } from 'drizzle-orm/pg-core';\n` +
			`export const shop = pgSchema('shop');\n` +
			`export const orders = pgTable('orders', { id: integer('id').primaryKey() });\n`;
		const before = `${head}export const shopOrders = shop.table('orders', { id: integer('id').primaryKey(), note: text('note') });\n`;
		const renamed = `${head}export const shopSales = shop.table('sales', { id: integer('id').primaryKey(), note: text('note') });\n`;
		const renamedAndDropped = `${head}export const shopPurchases = shop.table('purchases', { id: integer('id').primaryKey() });\n`;
		try {
			expect((await convergeRaw(db, dialect, p.dir, p.out, 'a', before)).status).toBe('applied');
			await db.raw('insert into public.orders (id) values (1), (2)');
			await db.raw("insert into shop.orders (id, note) values (1, 'keep')");

			// A pure rename applies; nobody is asked about `public.orders`.
			await nextSecond();
			const applied = await convergeRaw(db, dialect, p.dir, p.out, 'b', renamed, {
				audit: true,
				resolve: renamingFrom('orders'),
				confirmLoss: neverAsked,
			});
			expect(applied.status).toBe('applied');
			expect(await db.raw('select id from public.orders')).toHaveLength(2);
			expect(await db.raw('select note from shop.sales')).toHaveLength(1);

			// A rename beside a populated column drop is measured under the live, schema-qualified name.
			await nextSecond();
			const pending = await convergeRaw(db, dialect, p.dir, p.out, 'c', renamedAndDropped, {
				audit: true,
				resolve: renamingFrom('sales'),
			});
			expect(pending.status).toBe('pending');
			if (pending.status !== 'pending') return;
			expect(pending.findings.map((finding) => [finding.change, finding.affectedRows])).toEqual([
				[{ kind: 'drop_column', schema: 'shop', table: 'sales', column: 'note' }, 1],
			]);
		} finally {
			p.cleanup();
		}
	},
);

/** A `t(id, code varchar(length))` schema, for the narrowing case. */
function varcharModule(dialect: Dialect, length: number): string {
	return schemaModule(dialect, {
		t: ['id', `code: varchar('code', { length: ${length} })`],
	}).replace(
		'integer, numeric, text, uniqueIndex }',
		'integer, numeric, text, uniqueIndex, varchar }',
	);
}

// Postgres truncates under drizzle's explicit cast rather than refusing, so a narrowing over longer
// values is a decision like a drop: pending under audit, confirmable at a terminal.
matrixTest(
	'narrowing a string column over longer values is a decision',
	async ({ db, dialect }) => {
		if (dialect !== 'postgres') return;
		const p = tempProject();
		try {
			writeFileSync(join(p.dir, 'a.ts'), varcharModule(dialect, 255));
			expect(
				(
					await converge({
						db,
						dialect,
						schema: join(p.dir, 'a.ts'),
						out: p.out,
						resolve: asCreate,
					})
				).status,
			).toBe('applied');
			await db.raw("insert into t (id, code) values (1, 'abcdefghijklmnop')");

			writeFileSync(join(p.dir, 'b.ts'), varcharModule(dialect, 10));
			const pending = await converge({
				db,
				dialect,
				schema: join(p.dir, 'b.ts'),
				out: p.out,
				resolve: asCreate,
				audit: true,
			});
			expect(pending.status).toBe('pending');
			if (pending.status !== 'pending') return;
			expect(pending.findings.map((finding) => [finding.code, finding.affectedRows])).toEqual([
				['column_length_overflow', 1],
			]);
			expect(String((await db.raw('select code from t'))[0]?.['code'])).toBe('abcdefghijklmnop');

			writeFileSync(join(p.dir, 'c.ts'), varcharModule(dialect, 10));
			const declined = await converge({
				db,
				dialect,
				schema: join(p.dir, 'c.ts'),
				out: p.out,
				resolve: asCreate,
				confirmDrop: () => false,
			});
			expect(declined.status).toBe('drop_declined');

			writeFileSync(join(p.dir, 'd.ts'), varcharModule(dialect, 10));
			const applied = await converge({
				db,
				dialect,
				schema: join(p.dir, 'd.ts'),
				out: p.out,
				resolve: asCreate,
				confirmDrop: () => true,
			});
			expect(applied.status).toBe('applied');
			expect(String((await db.raw('select code from t'))[0]?.['code'])).toBe('abcdefghij');
		} finally {
			p.cleanup();
		}
	},
);
