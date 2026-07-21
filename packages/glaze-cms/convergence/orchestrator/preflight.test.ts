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
