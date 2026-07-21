import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, matrixTest } from '../../harness/index.ts';
import { converge } from './index.ts';

import type { DatabaseHandle, Dialect } from '../../dialect/index.ts';
import type { DecisionResolution } from './index.ts';

// End-to-end: the REAL generate (file) + the REAL apply oracle (DB from the harness), tied by the
// facade. drizzle computes; Glaze applies and guards. The human seams are deterministic stubs.

/** The package root — fixtures must live here so their `drizzle-orm` import resolves. */
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

/** A resolver used where no decision should arise; if one does, it defaults to `create`. */
const asCreate = (): DecisionResolution => ({ action: 'create' });

/** Builds a schema module for a dialect: `{ table: [columns] }` (an `id` column becomes the PK). */
function schemaModule(dialect: Dialect, tables: Record<string, readonly string[]>): string {
	const core = dialect === 'postgres' ? 'pg-core' : 'sqlite-core';
	const tableFn = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
	const decls = Object.entries(tables)
		.map(([name, columns]) => {
			const cols = columns
				.map((c) => (c === 'id' ? `id: integer('id').primaryKey()` : `${c}: text('${c}')`))
				.join(', ');
			return `export const ${name} = ${tableFn}('${name}', { ${cols} });`;
		})
		.join('\n');
	return `import { ${tableFn}, integer, text } from 'drizzle-orm/${core}';\n${decls}\n`;
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
	extra: { confirmLoss?: () => boolean; confirmDrop?: () => boolean; gate?: 'auto' | 'audit' } = {},
) {
	const schema = join(dir, `${name}.ts`);
	writeFileSync(schema, schemaModule(dialect, tables));
	return converge({ db, dialect, schema, out, resolve: asCreate, ...extra });
}

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

matrixTest(
	'converge in audit mode returns the SQL as pending without applying, and never desyncs',
	async ({ db, dialect }) => {
		const p = tempProject();
		try {
			const pending = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'a',
				{ widgets: ['id'] },
				{ gate: 'audit' },
			);
			expect(pending.status).toBe('pending');
			// The DB was not touched — the table does not exist.
			expect(await tableExists(db, 'widgets')).toBe(false);

			// No snapshot desync: because audit rolled the migration back, a subsequent auto converge
			// still sees the change and applies it (rather than reporting a false `no_changes`).
			const applied = await convergeSchema(db, dialect, p.dir, p.out, 'b', { widgets: ['id'] });
			expect(applied.status).toBe('applied');
			expect(await tableExists(db, 'widgets')).toBe(true);
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

			// No confirmer ⇒ the drop of a populated column is blocked; the column and its data survive.
			const blocked = await convergeSchema(db, dialect, p.dir, p.out, 'b', { people: ['id'] });
			expect(blocked.status).toBe('unsafe_change');
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
	'converge declines a populated-table drop, then applies it once confirmed',
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

			// Declining leaves the table — and rolls the snapshot back, so the same drop can be re-proposed.
			const declined = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'b',
				{ keep: ['id'] },
				{
					confirmLoss: () => false,
				},
			);
			expect(declined.status).toBe('data_loss_declined');
			expect(await db.raw('select id from gone')).toHaveLength(1);

			// Confirming applies the drop.
			const confirmed = await convergeSchema(
				db,
				dialect,
				p.dir,
				p.out,
				'c',
				{ keep: ['id'] },
				{
					confirmLoss: () => true,
				},
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
