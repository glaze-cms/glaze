import { expect, test } from '../../harness/index.ts';
import { deriveUnsafeChanges } from './preflight.ts';

import type { SnapshotColumn } from './preflight.ts';

// Pure tests for the snapshot-diff → UnsafeChange classifier (no DB). The live-DB probing that turns
// these descriptors into findings is covered by the safety suite and the converge matrix tests.

/** Builds a snapshot column with sensible defaults (public schema, nullable text). */
function col(table: string, name: string, overrides: Partial<SnapshotColumn> = {}): SnapshotColumn {
	return {
		schema: 'public',
		table,
		name,
		type: 'text',
		notNull: false,
		hasDefault: false,
		...overrides,
	};
}

test('deriveUnsafeChanges flags a dropped column when its table survives', () => {
	const parent = [col('users', 'id'), col('users', 'email')];
	const next = [col('users', 'id')];

	expect(deriveUnsafeChanges(parent, next)).toEqual([
		{ kind: 'drop_column', table: 'users', column: 'email' },
	]);
});

test('deriveUnsafeChanges does NOT flag columns of a wholly-dropped table (that is the oracle)', () => {
	const parent = [col('users', 'id'), col('users', 'email')];
	const next: SnapshotColumn[] = [];

	expect(deriveUnsafeChanges(parent, next)).toEqual([]);
});

test('deriveUnsafeChanges flags a column newly gaining NOT NULL', () => {
	const parent = [col('t', 'c')];
	const next = [col('t', 'c', { notNull: true })];

	expect(deriveUnsafeChanges(parent, next)).toEqual([
		{ kind: 'set_not_null', table: 't', column: 'c' },
	]);
});

test('deriveUnsafeChanges flags a narrowed varchar but not a widened one', () => {
	const narrowed = deriveUnsafeChanges(
		[col('t', 'c', { type: 'varchar(255)' })],
		[col('t', 'c', { type: 'varchar(10)' })],
	);
	expect(narrowed).toEqual([{ kind: 'narrow_column', table: 't', column: 'c', maxLength: 10 }]);

	const widened = deriveUnsafeChanges(
		[col('t', 'c', { type: 'varchar(10)' })],
		[col('t', 'c', { type: 'varchar(255)' })],
	);
	expect(widened).toEqual([]);
});

test('deriveUnsafeChanges flags a new NOT NULL column but not a nullable one', () => {
	const parent = [col('t', 'id')];

	const notNull = deriveUnsafeChanges(parent, [
		col('t', 'id'),
		col('t', 'flag', { notNull: true }),
	]);
	expect(notNull).toEqual([
		{ kind: 'add_not_null_column', table: 't', column: 'flag', hasDefault: false },
	]);

	const nullable = deriveUnsafeChanges(parent, [col('t', 'id'), col('t', 'note')]);
	expect(nullable).toEqual([]);
});

test('deriveUnsafeChanges keys columns unambiguously when identifiers contain spaces', () => {
	// Regression for the space-key collision: `('a b','c')` and `('a','b c')` collide under a
	// space-joined key, which would hide the drop of `c` (silent data loss). NUL-separated keys don't.
	const parent = [col('a b', 'id'), col('a b', 'c'), col('a', 'b c')];
	const next = [col('a b', 'id'), col('a', 'b c')]; // table `a b` survives; column `c` is dropped

	expect(deriveUnsafeChanges(parent, next)).toEqual([
		{ kind: 'drop_column', table: 'a b', column: 'c' },
	]);
});

test('deriveUnsafeChanges treats a resolved column rename as a rename, not a drop + add', () => {
	const parent = [col('users', 'id'), col('users', 'handle', { notNull: true })];
	const next = [col('users', 'id'), col('users', 'nick', { notNull: true })];

	// With the rename known, neither a drop of `handle` nor an add of `nick` is derived.
	expect(
		deriveUnsafeChanges(parent, next, [{ table: 'users', from: 'handle', to: 'nick' }]),
	).toEqual([]);

	// Without it, the same diff is (wrongly) read as a drop + a new NOT NULL column — the bug this guards.
	expect(deriveUnsafeChanges(parent, next)).toEqual([
		{ kind: 'drop_column', table: 'users', column: 'handle' },
		{ kind: 'add_not_null_column', table: 'users', column: 'nick', hasDefault: false },
	]);
});

test('deriveUnsafeChanges flags text → varchar(n) as a narrowing, but not the reverse', () => {
	expect(
		deriveUnsafeChanges(
			[col('t', 'c', { type: 'text' })],
			[col('t', 'c', { type: 'varchar(20)' })],
		),
	).toEqual([{ kind: 'narrow_column', table: 't', column: 'c', maxLength: 20 }]);

	expect(
		deriveUnsafeChanges(
			[col('t', 'c', { type: 'varchar(20)' })],
			[col('t', 'c', { type: 'text' })],
		),
	).toEqual([]);
});
