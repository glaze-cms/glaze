import { expect, test } from '../../harness/index.ts';
import { classifyChange } from './classifier.ts';

import type { Entity } from './types.ts';

// Pure tests for the classifier (no database). The measurement that turns a destructive change into
// a finding is covered by the safety suite; the whole path by the converge and runner matrices.

/** A table entity. */
function table(name: string, schema?: string): Entity {
	return { entityType: 'tables', name, ...(schema ? { schema } : {}) };
}

/** A column entity: nullable text unless overridden. */
function column(owner: string, name: string, overrides: Record<string, unknown> = {}): Entity {
	return {
		entityType: 'columns',
		table: owner,
		name,
		type: 'text',
		notNull: false,
		default: null,
		...overrides,
	};
}

/** An index column entry, the shape drizzle writes (`{ value, isExpression, … }`). */
function on(value: string): Record<string, unknown> {
	return { value, isExpression: false };
}

/** Any other entity that belongs to a table. */
function owned(
	entityType: string,
	owner: string,
	name: string,
	fields: Record<string, unknown> = {},
): Entity {
	return { entityType, table: owner, name, ...fields };
}

/** A populated `users(id, email)` snapshot. */
const USERS = [
	table('users'),
	column('users', 'id', { type: 'integer', notNull: true }),
	column('users', 'email'),
];

test('a table drop is destructive, and its columns are covered by it', () => {
	const result = classifyChange(USERS, []);

	expect(result.destructive).toEqual([{ kind: 'drop_table', table: 'users' }]);
	expect(result.unclassified).toEqual([]);
	expect(result.additive).toEqual([]);
});

test('a column drop on a surviving table is destructive', () => {
	const result = classifyChange(USERS, USERS.slice(0, 2));

	expect(result.destructive).toEqual([{ kind: 'drop_column', table: 'users', column: 'email' }]);
	expect(result.unclassified).toEqual([]);
});

// The rename + drop case that once applied silently: with the rename known, the drop is still seen,
// and it is measured under the table's LIVE name — the database has not been renamed yet. Nothing is
// derived for the rename itself.
test('a column dropped beside a table rename is still a column drop, measured live', () => {
	const next = [table('people'), column('people', 'id', { type: 'integer', notNull: true })];

	const result = classifyChange(USERS, next, {
		tables: [{ from: 'users', to: 'people' }],
		columns: [],
	});

	expect(result.destructive).toEqual([{ kind: 'drop_column', table: 'users', column: 'email' }]);
	expect(result.unclassified).toEqual([]);
	expect(result.additive).toEqual([]);
});

test('a resolved column rename is a rename, not a drop and an add', () => {
	const parent = [
		table('users'),
		column('users', 'id'),
		column('users', 'handle', { notNull: true }),
	];
	const next = [table('users'), column('users', 'id'), column('users', 'nick', { notNull: true })];

	const known = classifyChange(parent, next, {
		tables: [],
		columns: [{ table: 'users', from: 'handle', to: 'nick' }],
	});
	expect(known).toEqual({ additive: [], destructive: [], unclassified: [] });

	// Without it, the same diff reads as a drop plus a new required column — the bug this guards.
	const unknown = classifyChange(parent, next);
	expect(unknown.destructive).toEqual([
		{ kind: 'drop_column', table: 'users', column: 'handle' },
		{ kind: 'add_not_null_column', table: 'users', column: 'nick', hasDefault: false },
	]);
});

test('a measurement on a renamed column uses its live name', () => {
	const parent = [table('users'), column('users', 'handle', { notNull: false })];
	const next = [table('people'), column('people', 'nick', { notNull: true })];

	const result = classifyChange(parent, next, {
		tables: [{ from: 'users', to: 'people' }],
		columns: [{ table: 'people', from: 'handle', to: 'nick' }],
	});

	expect(result.destructive).toEqual([{ kind: 'set_not_null', table: 'users', column: 'handle' }]);
});

test('a column rename carries into the constraints and indexes that list it', () => {
	const parent = [
		table('users'),
		column('users', 'handle'),
		owned('uniques', 'users', 'users_handle_unique', { columns: ['handle'] }),
		owned('indexes', 'users', 'users_handle_uidx', { columns: [on('handle')], isUnique: true }),
	];
	const next = [
		table('users'),
		column('users', 'nick'),
		owned('uniques', 'users', 'users_handle_unique', { columns: ['nick'] }),
		owned('indexes', 'users', 'users_handle_uidx', { columns: [on('nick')], isUnique: true }),
	];

	const result = classifyChange(parent, next, {
		tables: [],
		columns: [{ table: 'users', from: 'handle', to: 'nick' }],
	});
	expect(result).toEqual({ additive: [], destructive: [], unclassified: [] });
});

// A foreign key names the schema it points into separately; a rename there must follow it, and a
// rename of a same-named table elsewhere must not.
test('a table rename follows foreign keys by the schema they point into', () => {
	const fk = (schema: string, schemaTo: string): Entity =>
		owned('fks', 'orders', 'orders_user_fk', {
			schema,
			columns: ['user_id'],
			schemaTo,
			tableTo: 'users',
			columnsTo: ['id'],
		});
	const users = (schema: string): Entity[] => [
		table('users', schema),
		column('users', 'id', { schema }),
	];
	const people = (schema: string): Entity[] => [
		table('people', schema),
		column('people', 'id', { schema }),
	];

	// The FK lives in public but points at shop.users; renaming public.users must leave it alone.
	const pointsAtShop = classifyChange(
		[...users('public'), ...users('shop'), table('orders', 'public'), fk('public', 'shop')],
		[...people('public'), ...users('shop'), table('orders', 'public'), fk('public', 'shop')],
		{ tables: [{ schema: 'public', from: 'users', to: 'people' }], columns: [] },
	);
	expect(pointsAtShop.unclassified).toEqual([]);

	// The FK lives in shop but points at public.users; renaming public.users must carry it along.
	const pointsAtPublic = classifyChange(
		[...users('public'), table('orders', 'shop'), fk('shop', 'public')],
		[...people('public'), table('orders', 'shop'), { ...fk('shop', 'public'), tableTo: 'people' }],
		{ tables: [{ schema: 'public', from: 'users', to: 'people' }], columns: [] },
	);
	expect(pointsAtPublic.unclassified).toEqual([]);
});

test('renaming the column a self-referencing foreign key points at is a rename', () => {
	const at = (id: string): Entity[] => [
		table('c'),
		column('c', id),
		column('c', 'parent_id'),
		owned('fks', 'c', 'c_parent_fk', { columns: ['parent_id'], tableTo: 'c', columnsTo: [id] }),
	];

	const result = classifyChange(at('id'), at('cid'), {
		tables: [],
		columns: [{ table: 'c', from: 'id', to: 'cid' }],
	});

	expect(result).toEqual({ additive: [], destructive: [], unclassified: [] });
});

test('a type change on an array column is unclassified, not measured', () => {
	const at = (type: string): Entity[] => [table('t'), column('t', 'tags', { type, dimensions: 1 })];

	const result = classifyChange(at('varchar(255)'), at('varchar(10)'));

	expect(result.destructive).toEqual([]);
	expect(result.unclassified.map((op) => op.name)).toEqual(['tags']);
});

// The numeric case that once applied silently: only string types have a rule for narrowing.
test('a type change outside the string family is unclassified', () => {
	const parent = [table('t'), column('t', 'price', { type: 'numeric(10,4)' })];
	const next = [table('t'), column('t', 'price', { type: 'numeric(10,2)' })];

	const result = classifyChange(parent, next);

	expect(result.destructive).toEqual([]);
	expect(result.unclassified).toEqual([
		{
			entityType: 'columns',
			op: 'alter',
			schema: 'public',
			table: 't',
			name: 'price',
			changed: ['type'],
			detail: 'numeric(10,4) → numeric(10,2)',
		},
	]);
});

test('widening a string is additive; narrowing it, text included, is destructive', () => {
	const at = (type: string): Entity[] => [table('t'), column('t', 'c', { type })];

	expect(classifyChange(at('varchar(10)'), at('varchar(255)')).additive).toHaveLength(1);
	expect(classifyChange(at('varchar(20)'), at('text')).additive).toHaveLength(1);
	// SQLite writes `text(n)`; it is a string type like any other.
	expect(classifyChange(at('text(10)'), at('text')).additive).toHaveLength(1);
	expect(classifyChange(at('text(255)'), at('text(10)')).destructive).toEqual([
		{ kind: 'narrow_column', table: 't', column: 'c', maxLength: 10 },
	]);
	expect(classifyChange(at('varchar(255)'), at('varchar(10)')).destructive).toEqual([
		{ kind: 'narrow_column', table: 't', column: 'c', maxLength: 10 },
	]);
	expect(classifyChange(at('text'), at('varchar(20)')).destructive).toEqual([
		{ kind: 'narrow_column', table: 't', column: 'c', maxLength: 20 },
	]);
});

test('gaining NOT NULL is destructive; losing it, or changing a default, is additive', () => {
	const at = (fields: Record<string, unknown>): Entity[] => [table('t'), column('t', 'c', fields)];

	expect(classifyChange(at({ notNull: false }), at({ notNull: true })).destructive).toEqual([
		{ kind: 'set_not_null', table: 't', column: 'c' },
	]);
	const relaxed = classifyChange(at({ notNull: true }), at({ notNull: false }));
	expect(relaxed.destructive).toEqual([]);
	expect(relaxed.unclassified).toEqual([]);
	expect(relaxed.additive).toHaveLength(1);
	expect(classifyChange(at({ default: null }), at({ default: "'x'" })).additive).toHaveLength(1);
});

// The database fills these itself, so a required column of one needs no value from anybody.
test('a required identity or serial column is additive; a required generated one is unclassified', () => {
	const parent = [table('t'), column('t', 'id')];

	const identity = column('t', 'n', {
		type: 'integer',
		notNull: true,
		identity: { type: 'always' },
	});
	const serial = column('t', 's', { type: 'serial', notNull: true });
	for (const added of [identity, serial]) {
		const result = classifyChange(parent, [...parent, added]);
		expect(result.destructive).toEqual([]);
		expect(result.unclassified).toEqual([]);
	}

	// Computed, but nothing here knows whether the expression has a value for every existing row.
	const generated = column('t', 'g', {
		type: 'integer',
		notNull: true,
		generated: { as: 'a + 1' },
	});
	const required = classifyChange(parent, [...parent, generated]);
	expect(required.destructive).toEqual([]);
	expect(required.unclassified.map((op) => op.name)).toEqual(['g']);

	// Nullable, it is additive like any other nullable column.
	const optional = column('t', 'g', {
		type: 'integer',
		notNull: false,
		generated: { as: 'a + 1' },
	});
	expect(classifyChange(parent, [...parent, optional]).additive.map((op) => op.name)).toEqual([
		'g',
	]);
});

test('dropping a generated column is additive: it stored nothing of its own', () => {
	const generated = column('t', 'g', { generated: { as: '1' } });
	const result = classifyChange(
		[table('t'), column('t', 'id'), generated],
		[table('t'), column('t', 'id')],
	);

	expect(result.destructive).toEqual([]);
	expect(result.additive.map((op) => op.name)).toEqual(['g']);
});

test('a new column is additive unless it is required without a default', () => {
	const parent = [table('t'), column('t', 'id')];

	const nullable = classifyChange(parent, [...parent, column('t', 'note')]);
	expect(nullable.additive).toHaveLength(1);
	expect(nullable.destructive).toEqual([]);

	const defaulted = classifyChange(parent, [
		...parent,
		column('t', 'flag', { notNull: true, default: 'false' }),
	]);
	expect(defaulted.destructive).toEqual([]);

	const required = classifyChange(parent, [...parent, column('t', 'flag', { notNull: true })]);
	expect(required.destructive).toEqual([
		{ kind: 'add_not_null_column', table: 't', column: 'flag', hasDefault: false },
	]);
});

test('a brand-new table is additive with everything under it', () => {
	const next = [
		table('posts'),
		column('posts', 'id', { type: 'integer', notNull: true }),
		column('posts', 'slug', { notNull: true }),
		owned('pks', 'posts', 'posts_pkey', { columns: ['id'] }),
		owned('uniques', 'posts', 'posts_slug_unique', { columns: ['slug'] }),
		owned('indexes', 'posts', 'posts_slug_idx', { columns: [on('slug')], isUnique: false }),
		owned('fks', 'posts', 'posts_author_fk', { columns: ['author_id'], tableTo: 'users' }),
	];

	const result = classifyChange([], next);

	expect(result.additive.map((op) => op.name)).toEqual(['posts']);
	expect(result.destructive).toEqual([]);
	expect(result.unclassified).toEqual([]);
});

test('indexes: adding a plain one or dropping any is additive; adding a unique one is measured', () => {
	const base = [table('t'), column('t', 'c')];
	const plain = owned('indexes', 't', 't_c_idx', { columns: [on('c')], isUnique: false });
	const unique = owned('indexes', 't', 't_c_uidx', { columns: [on('c')], isUnique: true });

	expect(classifyChange(base, [...base, plain]).additive).toHaveLength(1);
	expect(classifyChange(base, [...base, plain]).unclassified).toEqual([]);
	expect(classifyChange([...base, plain], base).additive).toHaveLength(1);
	expect(classifyChange([...base, plain], base).unclassified).toEqual([]);
	expect(classifyChange(base, [...base, unique]).destructive).toEqual([
		{ kind: 'add_unique', table: 't', column: 'c' },
	]);
});

test('a unique index over an expression or with a where clause is unclassified', () => {
	const base = [table('t'), column('t', 'c')];
	const expression = owned('indexes', 't', 't_lower_idx', {
		columns: [{ value: 'lower("c")', isExpression: true }],
		isUnique: true,
	});
	const partial = owned('indexes', 't', 't_c_live_idx', {
		columns: [on('c')],
		isUnique: true,
		where: '"deleted_at" is null',
	});

	expect(classifyChange(base, [...base, expression]).unclassified).toHaveLength(1);
	expect(classifyChange(base, [...base, partial]).unclassified).toHaveLength(1);
});

// A unique over a column that arrives with a default would fail over two rows: every existing row
// gets the same value. Nothing here counts rows, so it waits.
test('uniqueness over a new column that arrives with a default is unclassified', () => {
	const base = [table('t'), column('t', 'id')];
	const next = [
		...base,
		column('t', 'code', { default: "'x'" }),
		owned('uniques', 't', 't_code_unique', { columns: ['code'] }),
	];

	const result = classifyChange(base, next);

	expect(result.destructive).toEqual([]);
	expect(result.unclassified.map((op) => op.name)).toEqual(['t_code_unique']);
});

// A unique over a column that arrives in the same change has no values to be duplicated.
test('uniqueness over a column created in the same change is additive', () => {
	const base = [table('t'), column('t', 'id')];
	const next = [
		...base,
		column('t', 'email'),
		owned('uniques', 't', 't_email_unique', { columns: ['email'] }),
		owned('indexes', 't', 't_email_uidx', { columns: [on('email')], isUnique: true }),
	];

	const result = classifyChange(base, next);

	expect(result.destructive).toEqual([]);
	expect(result.unclassified).toEqual([]);
	expect(result.additive.map((op) => op.name)).toEqual(['email', 't_email_unique', 't_email_uidx']);
});

test('a unique constraint over one column is measured; over several it is unclassified', () => {
	const base = [table('t'), column('t', 'a'), column('t', 'b')];
	const single = owned('uniques', 't', 't_a_unique', { columns: ['a'] });
	const composite = owned('uniques', 't', 't_ab_unique', { columns: ['a', 'b'] });

	expect(classifyChange(base, [...base, single]).destructive).toEqual([
		{ kind: 'add_unique', table: 't', column: 'a' },
	]);
	expect(classifyChange(base, [...base, composite]).unclassified).toHaveLength(1);
	// Dropping either takes no values with it.
	expect(classifyChange([...base, composite], base).additive).toHaveLength(1);
	expect(classifyChange([...base, composite], base).unclassified).toEqual([]);
});

test('a foreign key, check or primary key added to an existing table is unclassified', () => {
	const base = [table('t'), column('t', 'a')];

	for (const kind of ['fks', 'checks', 'pks']) {
		const result = classifyChange(base, [...base, owned(kind, 't', `t_${kind}`)]);
		expect(result.unclassified.map((op) => op.entityType)).toEqual([kind]);
	}
});

test('an entity type with no rule is unclassified whatever happened to it', () => {
	const base = [table('t')];
	const policy = { entityType: 'policies', table: 't', name: 'p', for: 'select' } as Entity;
	const changed = { ...policy, for: 'all' } as Entity;

	expect(classifyChange(base, [...base, policy]).unclassified).toHaveLength(1);
	expect(classifyChange([...base, policy], base).unclassified).toHaveLength(1);
	expect(classifyChange([...base, policy], [...base, changed]).unclassified).toHaveLength(1);
});

test('an altered column with a rule-less field is unclassified but keeps its measurements', () => {
	const parent = [table('t'), column('t', 'c', { notNull: false, generated: null })];
	const next = [table('t'), column('t', 'c', { notNull: true, generated: { as: '1' } })];

	const result = classifyChange(parent, next);

	expect(result.unclassified).toHaveLength(1);
	// The person is told what changed, field by field.
	expect(result.unclassified[0]?.detail).toBe(
		'notNull: false → true; generated: none → {"as":"1"}',
	);
	expect(result.destructive).toEqual([{ kind: 'set_not_null', table: 't', column: 'c' }]);
});

test('entities are keyed unambiguously when identifiers contain spaces', () => {
	// `('a b','c')` and `('a','b c')` collide under a space-joined key, which would hide the drop of
	// `c`. NUL-separated keys do not.
	const parent = [
		table('a b'),
		table('a'),
		column('a b', 'id'),
		column('a b', 'c'),
		column('a', 'b c'),
	];
	const next = [table('a b'), table('a'), column('a b', 'id'), column('a', 'b c')];

	expect(classifyChange(parent, next).destructive).toEqual([
		{ kind: 'drop_column', table: 'a b', column: 'c' },
	]);
});

test("a Postgres schema is part of an entity's identity, and travels with the measurement", () => {
	const parent = [table('t', 'public'), column('t', 'c', { schema: 'public' })];
	const next = [table('t', 'archive'), column('t', 'c', { schema: 'archive' })];

	const result = classifyChange(parent, next);

	// Same names in another schema: the public table is gone and the archive one is new.
	expect(result.destructive).toEqual([{ kind: 'drop_table', schema: 'public', table: 't' }]);
	expect(result.additive.map((op) => `${op.schema}.${op.name}`)).toEqual(['archive.t']);
});

// A same-named table in another schema must not be measured, or renamed, in its place.
test('a schema-qualified drop and rename never touch a same-named table elsewhere', () => {
	const parent = [
		table('orders', 'shop'),
		column('orders', 'note', { schema: 'shop' }),
		table('orders', 'public'),
		column('orders', 'note', { schema: 'public' }),
	];

	const dropped = classifyChange(parent, [
		table('orders', 'public'),
		column('orders', 'note', { schema: 'public' }),
	]);
	expect(dropped.destructive).toEqual([{ kind: 'drop_table', schema: 'shop', table: 'orders' }]);

	const renamed = classifyChange(
		parent,
		[
			table('sales', 'shop'),
			table('orders', 'public'),
			column('orders', 'note', { schema: 'public' }),
		],
		{ tables: [{ schema: 'shop', from: 'orders', to: 'sales' }], columns: [] },
	);
	// `shop.orders` became `shop.sales` and lost `note`; `public.orders` is untouched.
	expect(renamed.destructive).toEqual([
		{ kind: 'drop_column', schema: 'shop', table: 'orders', column: 'note' },
	]);
	expect(renamed.unclassified).toEqual([]);
});
