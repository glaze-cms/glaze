/**
 * Unit tests for the constraint-violation classifiers. Pure and dialect-shaped: the inputs are
 * synthetic error objects matching what `postgres.js` and `bun:sqlite`/`better-sqlite3` actually throw
 * (captured empirically). No database — this runs identically on both runtimes.
 */

import { expect, test } from '#harness';

import { classifyPostgresConstraint, classifySqliteConstraint } from './errors.ts';

test('postgres: unique violation → CONFLICT kind with the column from detail', () => {
	const v = classifyPostgresConstraint({
		code: '23505',
		detail: 'Key (email)=(a@b.com) already exists.',
	});
	expect(v?.kind).toBe('unique');
	expect(v?.columns).toEqual(['email']);
});

test('postgres: composite unique violation → both columns, values never read', () => {
	const v = classifyPostgresConstraint({
		code: '23505',
		detail: 'Key (a, b)=(1, 2) already exists.',
	});
	expect(v?.kind).toBe('unique');
	expect(v?.columns).toEqual(['a', 'b']);
});

test('postgres: not-null violation → NOT_NULL from column_name, detail (row values) ignored', () => {
	const v = classifyPostgresConstraint({
		code: '23502',
		column_name: 'title',
		detail: 'Failing row contains (3, e@f.com, null, 1, null).',
	});
	expect(v?.kind).toBe('not_null');
	expect(v?.columns).toEqual(['title']);
});

test('postgres: foreign-key violation → FOREIGN_KEY with the referencing column', () => {
	const v = classifyPostgresConstraint({
		code: '23503',
		detail: 'Key (parent_id)=(999) is not present in table "parent".',
	});
	expect(v?.kind).toBe('foreign_key');
	expect(v?.columns).toEqual(['parent_id']);
});

test('postgres: check violation → CHECK with no column (detail is never parsed)', () => {
	const v = classifyPostgresConstraint({
		code: '23514',
		constraint_name: 't_age_check',
		detail: 'Failing row contains (4, g@h.com, w, -5, null).',
	});
	expect(v?.kind).toBe('check');
	expect(v?.columns).toEqual([]);
});

test('postgres: other 23-class code → unknown constraint, no columns', () => {
	const v = classifyPostgresConstraint({ code: '23P01' });
	expect(v?.kind).toBe('unknown');
	expect(v?.columns).toEqual([]);
});

test('postgres: non-constraint / malformed errors → null', () => {
	expect(classifyPostgresConstraint({ code: '42P01' })).toBeNull();
	expect(classifyPostgresConstraint(new Error('boom'))).toBeNull();
	expect(classifyPostgresConstraint({})).toBeNull();
	expect(classifyPostgresConstraint(null)).toBeNull();
});

test('sqlite: unique violation → CONFLICT with the column stripped of its table prefix', () => {
	const v = classifySqliteConstraint({
		code: 'SQLITE_CONSTRAINT_UNIQUE',
		message: 'UNIQUE constraint failed: t.email',
	});
	expect(v?.kind).toBe('unique');
	expect(v?.columns).toEqual(['email']);
});

test('sqlite: primary-key violation → unique kind', () => {
	const v = classifySqliteConstraint({
		code: 'SQLITE_CONSTRAINT_PRIMARYKEY',
		message: 'UNIQUE constraint failed: t.id',
	});
	expect(v?.kind).toBe('unique');
	expect(v?.columns).toEqual(['id']);
});

test('sqlite: composite unique violation → both columns', () => {
	const v = classifySqliteConstraint({
		code: 'SQLITE_CONSTRAINT_UNIQUE',
		message: 'UNIQUE constraint failed: t.a, t.b',
	});
	expect(v?.columns).toEqual(['a', 'b']);
});

test('sqlite: not-null violation → NOT_NULL with the column', () => {
	const v = classifySqliteConstraint({
		code: 'SQLITE_CONSTRAINT_NOTNULL',
		message: 'NOT NULL constraint failed: t.title',
	});
	expect(v?.kind).toBe('not_null');
	expect(v?.columns).toEqual(['title']);
});

test('sqlite: check violation → CHECK, and the expression tail is NOT parsed as a column', () => {
	const v = classifySqliteConstraint({
		code: 'SQLITE_CONSTRAINT_CHECK',
		message: 'CHECK constraint failed: age >= 0',
	});
	expect(v?.kind).toBe('check');
	expect(v?.columns).toEqual([]);
});

test('sqlite: foreign-key violation → FOREIGN_KEY with no column', () => {
	const v = classifySqliteConstraint({
		code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
		message: 'FOREIGN KEY constraint failed',
	});
	expect(v?.kind).toBe('foreign_key');
	expect(v?.columns).toEqual([]);
});

test('sqlite: message-only fallback (bare SQLITE_CONSTRAINT, extended codes off)', () => {
	const v = classifySqliteConstraint({
		code: 'SQLITE_CONSTRAINT',
		message: 'UNIQUE constraint failed: t.email',
	});
	expect(v?.kind).toBe('unique');
	expect(v?.columns).toEqual(['email']);
});

test('sqlite: node:sqlite shape (code ERR_SQLITE_ERROR) classifies via the message', () => {
	// node:sqlite reports a generic `ERR_SQLITE_ERROR` code (not `SQLITE_CONSTRAINT_*`) but the same
	// message, so the message fallback carries it — for the Node runtime leg.
	const v = classifySqliteConstraint({
		code: 'ERR_SQLITE_ERROR',
		message: 'UNIQUE constraint failed: t.email',
	});
	expect(v?.kind).toBe('unique');
	expect(v?.columns).toEqual(['email']);
});

test('sqlite: recognized-but-unclassified constraint → unknown, no columns', () => {
	const v = classifySqliteConstraint({
		code: 'SQLITE_CONSTRAINT',
		message: 'abort at 12 in [INSERT ...]: constraint failed',
	});
	expect(v?.kind).toBe('unknown');
	expect(v?.columns).toEqual([]);
});

test('sqlite: non-constraint / malformed errors → null', () => {
	expect(
		classifySqliteConstraint({ code: 'SQLITE_ERROR', message: 'no such table: t' }),
	).toBeNull();
	expect(classifySqliteConstraint(new Error('boom'))).toBeNull();
	expect(classifySqliteConstraint(null)).toBeNull();
});

test('both dialects unwrap a Drizzle-wrapped error (real driver error on .cause)', () => {
	// Drizzle throws a DrizzleQueryError and carries the driver error on `.cause` — the classifier must
	// walk the chain, not just read the top-level wrapper (which has no code).
	const pgWrapped = {
		name: 'DrizzleQueryError',
		message: 'Failed query: insert into posts …',
		cause: { code: '23505', detail: 'Key (email)=(a@b.com) already exists.' },
	};
	expect(classifyPostgresConstraint(pgWrapped)?.kind).toBe('unique');
	expect(classifyPostgresConstraint(pgWrapped)?.columns).toEqual(['email']);

	const sqliteWrapped = {
		name: 'DrizzleQueryError',
		message: 'Failed query: insert into posts …',
		cause: {
			name: 'SQLiteError',
			code: 'SQLITE_CONSTRAINT_PRIMARYKEY',
			message: 'UNIQUE constraint failed: posts.id',
		},
	};
	expect(classifySqliteConstraint(sqliteWrapped)?.kind).toBe('unique');
	expect(classifySqliteConstraint(sqliteWrapped)?.columns).toEqual(['id']);
});

test('a Drizzle-wrapped NON-constraint error stays unclassified (must not mask a 500)', () => {
	// A syntax / undefined-column failure is a real fault; misclassifying it as a 4xx would hide a bug.
	const pgWrapped = {
		name: 'DrizzleQueryError',
		message: 'Failed query',
		cause: { code: '42703', message: 'column "nope" does not exist' },
	};
	expect(classifyPostgresConstraint(pgWrapped)).toBeNull();

	const sqliteWrapped = {
		name: 'DrizzleQueryError',
		message: 'Failed query',
		cause: { code: 'SQLITE_ERROR', message: 'no such column: nope' },
	};
	expect(classifySqliteConstraint(sqliteWrapped)).toBeNull();
});

test('a cyclic cause chain terminates and returns null', () => {
	const a: { name: string; cause?: unknown } = { name: 'A' };
	const b: { name: string; cause?: unknown } = { name: 'B', cause: a };
	a.cause = b;
	expect(classifySqliteConstraint(a)).toBeNull();
});

test('classifiers do not cross-classify the other dialect’s error', () => {
	// A Postgres error has no SQLite code/phrase, and a SQLite error has no 23-class code.
	expect(
		classifySqliteConstraint({ code: '23505', message: 'violates unique constraint' }),
	).toBeNull();
	expect(classifyPostgresConstraint({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBeNull();
});
