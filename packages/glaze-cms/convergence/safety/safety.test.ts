import { expect, matrixTest, test } from '../../harness/index.ts';
import { assertNonNegativeInteger, quoteIdentifier } from '../sql.ts';
import { DATA_LOSS_CODES, detectDataLoss } from './index.ts';

import type { DatabaseHandle } from '../../dialect/index.ts';
import type { QueryExecutor } from './index.ts';

/**
 * Binds the dialect seam's raw executor as a {@link QueryExecutor}. The detector runs the same SQL
 * on both dialects, so every matrix spec below asserts identical behavior for Postgres and SQLite
 * (except where a dialect genuinely differs, e.g. `narrow_column`).
 */
function queryOf(db: DatabaseHandle): QueryExecutor {
	return (sql) => db.raw(sql);
}

// ── Pure unit tests: identifier safety (no DB) ────────────────────────────────

test('quoteIdentifier escapes and quotes legal identifiers', () => {
	expect(quoteIdentifier('note')).toBe('"note"');
	expect(quoteIdentifier('user-profiles')).toBe('"user-profiles"');
	expect(quoteIdentifier('order id')).toBe('"order id"');
	expect(quoteIdentifier('2fa')).toBe('"2fa"');
	// An embedded double quote is doubled — no injection escape.
	expect(quoteIdentifier('a"b')).toBe('"a""b"');
	expect(quoteIdentifier('x"; DROP TABLE t; --')).toBe('"x""; DROP TABLE t; --"');
});

test('quoteIdentifier rejects empty, NUL-byte, and over-long identifiers', () => {
	expect(() => quoteIdentifier('')).toThrow();
	expect(() => quoteIdentifier('a\0b')).toThrow();
	expect(() => quoteIdentifier('x'.repeat(64))).toThrow();
	expect(quoteIdentifier('x'.repeat(63))).toBe(`"${'x'.repeat(63)}"`);
});

test('assertNonNegativeInteger accepts non-negative integers and rejects the rest', () => {
	expect(assertNonNegativeInteger(0)).toBe(0);
	expect(assertNonNegativeInteger(255)).toBe(255);
	expect(() => assertNonNegativeInteger(-1)).toThrow();
	expect(() => assertNonNegativeInteger(1.5)).toThrow();
	expect(() => assertNonNegativeInteger(Number.NaN)).toThrow();
	expect(() => assertNonNegativeInteger(Number.POSITIVE_INFINITY)).toThrow();
});

test('DATA_LOSS_CODES are unique and include the fail-closed code', () => {
	expect(new Set(DATA_LOSS_CODES).size).toBe(DATA_LOSS_CODES.length);
	expect(DATA_LOSS_CODES).toContain('could_not_verify');
});

// ── Matrix oracle: real data on Postgres AND SQLite ───────────────────────────

matrixTest(
	'set_not_null flags existing NULLs and ignores a clean column',
	async ({ db, dialect }) => {
		const query = queryOf(db);
		await db.raw('create table t_nn (id integer primary key, note text, tag text)');
		await db.raw("insert into t_nn (id, note, tag) values (1, 'a', 'x')");
		await db.raw('insert into t_nn (id, note, tag) values (2, null, null)');
		await db.raw('insert into t_nn (id, note, tag) values (3, null, null)');

		const flagged = await detectDataLoss(query, dialect, [
			{ kind: 'set_not_null', table: 't_nn', column: 'note' },
		]);
		expect(flagged).toHaveLength(1);
		expect(flagged[0]?.code).toBe('not_null_existing_nulls');
		expect(flagged[0]?.affectedRows).toBe(2);

		// `id` has no NULLs → safe, no finding.
		const clean = await detectDataLoss(query, dialect, [
			{ kind: 'set_not_null', table: 't_nn', column: 'id' },
		]);
		expect(clean).toHaveLength(0);
	},
);

matrixTest(
	'add_not_null_column flags a non-empty table but allows a default or an empty table',
	async ({ db, dialect }) => {
		const query = queryOf(db);
		await db.raw('create table t_add (id integer primary key)');

		// Empty table → safe even without a default (confirmed on both dialects).
		const onEmpty = await detectDataLoss(query, dialect, [
			{ kind: 'add_not_null_column', table: 't_add', column: 'bio', hasDefault: false },
		]);
		expect(onEmpty).toHaveLength(0);

		await db.raw('insert into t_add (id) values (1)');
		await db.raw('insert into t_add (id) values (2)');

		// Non-empty + no default → unsafe.
		const noDefault = await detectDataLoss(query, dialect, [
			{ kind: 'add_not_null_column', table: 't_add', column: 'bio', hasDefault: false },
		]);
		expect(noDefault).toHaveLength(1);
		expect(noDefault[0]?.code).toBe('not_null_column_non_empty');
		expect(noDefault[0]?.affectedRows).toBe(2);

		// Non-empty + default → safe.
		const withDefault = await detectDataLoss(query, dialect, [
			{ kind: 'add_not_null_column', table: 't_add', column: 'bio', hasDefault: true },
		]);
		expect(withDefault).toHaveLength(0);
	},
);

matrixTest('add_unique flags duplicates but permits multiple NULLs', async ({ db, dialect }) => {
	const query = queryOf(db);
	await db.raw('create table t_uq (id integer primary key, email text)');
	await db.raw("insert into t_uq (id, email) values (1, 'a@b.c')");
	await db.raw("insert into t_uq (id, email) values (2, 'a@b.c')");
	await db.raw("insert into t_uq (id, email) values (3, 'unique@b.c')");
	await db.raw('insert into t_uq (id, email) values (4, null)');
	await db.raw('insert into t_uq (id, email) values (5, null)');

	const flagged = await detectDataLoss(query, dialect, [
		{ kind: 'add_unique', table: 't_uq', column: 'email' },
	]);
	expect(flagged).toHaveLength(1);
	expect(flagged[0]?.code).toBe('unique_duplicates');
	// One duplicated value ('a@b.c'); the two NULLs are not duplicates.
	expect(flagged[0]?.affectedRows).toBe(1);
});

matrixTest('add_unique respects the column collation', async ({ db, dialect }) => {
	const query = queryOf(db);

	if (dialect === 'sqlite') {
		// A NOCASE column makes 'A@b.c' and 'a@b.c' equal, so UNIQUE would collide.
		await db.raw('create table t_ci (id integer primary key, email text collate nocase)');
		await db.raw("insert into t_ci (id, email) values (1, 'A@b.c')");
		await db.raw("insert into t_ci (id, email) values (2, 'a@b.c')");

		const flagged = await detectDataLoss(query, dialect, [
			{ kind: 'add_unique', table: 't_ci', column: 'email' },
		]);
		expect(flagged).toHaveLength(1);
		expect(flagged[0]?.code).toBe('unique_duplicates');
		expect(flagged[0]?.affectedRows).toBe(1);
	} else {
		// Postgres default collation is case-sensitive: the two values are distinct → safe.
		await db.raw('create table t_ci (id integer primary key, email text)');
		await db.raw("insert into t_ci (id, email) values (1, 'A@b.c')");
		await db.raw("insert into t_ci (id, email) values (2, 'a@b.c')");

		const flagged = await detectDataLoss(query, dialect, [
			{ kind: 'add_unique', table: 't_ci', column: 'email' },
		]);
		expect(flagged).toHaveLength(0);

		// A citext (case-insensitive) column DOES collide → detected, proving GROUP BY honors the
		// column's collation on Postgres too.
		await db.raw('create extension if not exists citext');
		await db.raw('create table t_ci2 (id integer primary key, email citext)');
		await db.raw("insert into t_ci2 (id, email) values (1, 'A@b.c')");
		await db.raw("insert into t_ci2 (id, email) values (2, 'a@b.c')");

		const citextFlagged = await detectDataLoss(query, dialect, [
			{ kind: 'add_unique', table: 't_ci2', column: 'email' },
		]);
		expect(citextFlagged).toHaveLength(1);
		expect(citextFlagged[0]?.code).toBe('unique_duplicates');
	}
});

matrixTest('add_unique with nullsNotDistinct flags multiple NULLs', async ({ db, dialect }) => {
	const query = queryOf(db);
	await db.raw('create table t_nd (id integer primary key, email text)');
	await db.raw('insert into t_nd (id, email) values (1, null)');
	await db.raw('insert into t_nd (id, email) values (2, null)');

	// Default: multiple NULLs are permitted → safe.
	const permissive = await detectDataLoss(query, dialect, [
		{ kind: 'add_unique', table: 't_nd', column: 'email' },
	]);
	expect(permissive).toHaveLength(0);

	// NULLS NOT DISTINCT is a Postgres-only constraint: two NULLs collide there, but on SQLite the
	// flag is ignored (the constraint cannot exist), so it stays safe.
	const strict = await detectDataLoss(query, dialect, [
		{ kind: 'add_unique', table: 't_nd', column: 'email', nullsNotDistinct: true },
	]);
	if (dialect === 'postgres') {
		expect(strict).toHaveLength(1);
		expect(strict[0]?.code).toBe('unique_duplicates');
	} else {
		expect(strict).toHaveLength(0);
	}
});

matrixTest(
	'narrow_column flags overflow on Postgres and is a no-op on SQLite',
	async ({ db, dialect }) => {
		const query = queryOf(db);
		await db.raw('create table t_len (id integer primary key, code text)');
		await db.raw("insert into t_len (id, code) values (1, 'ab')"); // fits
		await db.raw("insert into t_len (id, code) values (2, 'abcdef')"); // > len 3
		await db.raw('insert into t_len (id, code) values (3, null)'); // NULL, not counted

		const flagged = await detectDataLoss(query, dialect, [
			{ kind: 'narrow_column', table: 't_len', column: 'code', maxLength: 3 },
		]);

		if (dialect === 'postgres') {
			expect(flagged).toHaveLength(1);
			expect(flagged[0]?.code).toBe('column_length_overflow');
			expect(flagged[0]?.affectedRows).toBe(1);
		} else {
			// SQLite does not enforce column length, so narrowing loses nothing.
			expect(flagged).toHaveLength(0);
		}
	},
);

matrixTest(
	'fails closed: an unverifiable change yields could_not_verify without aborting siblings',
	async ({ db, dialect }) => {
		const query = queryOf(db);
		await db.raw('create table t_ok (id integer primary key, note text)');
		await db.raw('insert into t_ok (id, note) values (1, null)');

		// A missing table cannot be verified → could_not_verify, not a throw and not "safe".
		const unverifiable = await detectDataLoss(query, dialect, [
			{ kind: 'set_not_null', table: 'does_not_exist', column: 'x' },
		]);
		expect(unverifiable).toHaveLength(1);
		expect(unverifiable[0]?.code).toBe('could_not_verify');
		expect(unverifiable[0]?.affectedRows).toBeNull();

		// The failing probe must not erase a sibling change's real finding.
		const mixed = await detectDataLoss(query, dialect, [
			{ kind: 'set_not_null', table: 'does_not_exist', column: 'x' },
			{ kind: 'set_not_null', table: 't_ok', column: 'note' },
		]);
		expect(mixed.map((f) => f.code)).toEqual(['could_not_verify', 'not_null_existing_nulls']);
	},
);

matrixTest('probes identifiers with hyphens and spaces safely', async ({ db, dialect }) => {
	const query = queryOf(db);
	await db.raw('create table "t-dash" (id integer primary key, "the note" text)');
	await db.raw('insert into "t-dash" (id, "the note") values (1, null)');

	const flagged = await detectDataLoss(query, dialect, [
		{ kind: 'set_not_null', table: 't-dash', column: 'the note' },
	]);
	expect(flagged).toHaveLength(1);
	expect(flagged[0]?.code).toBe('not_null_existing_nulls');
	expect(flagged[0]?.affectedRows).toBe(1);
});

matrixTest(
	'detectDataLoss aggregates multiple changes in order and is empty when safe',
	async ({ db, dialect }) => {
		const query = queryOf(db);
		await db.raw('create table t_mix (id integer primary key, note text, email text)');
		await db.raw("insert into t_mix (id, note, email) values (1, null, 'dup')");
		await db.raw("insert into t_mix (id, note, email) values (2, 'ok', 'dup')");

		const findings = await detectDataLoss(query, dialect, [
			{ kind: 'set_not_null', table: 't_mix', column: 'note' },
			{ kind: 'add_unique', table: 't_mix', column: 'email' },
		]);
		expect(findings).toHaveLength(2);
		expect(findings.map((f) => f.code)).toEqual(['not_null_existing_nulls', 'unique_duplicates']);

		// A change set with nothing offending returns no findings.
		const safe = await detectDataLoss(query, dialect, [
			{ kind: 'set_not_null', table: 't_mix', column: 'id' },
		]);
		expect(safe).toHaveLength(0);
	},
);
