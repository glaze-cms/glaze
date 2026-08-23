/**
 * The content CRUD data operations, over Drizzle's core query builder. Kept separate from the Elysia
 * wiring (`router.ts`) so the data path is testable on its own and the router stays a thin table of
 * contents mapping results to HTTP status codes.
 *
 * `DatabaseHandle.db` is typed `unknown` at the request boundary and the drizzle instance is dialect-
 * specific — but the **core builder** (`select/insert/update/delete` + `eq`) is runtime-identical across
 * Postgres and SQLite. {@link ContentDb} is the one documented, dialect-agnostic cast for it (matrix
 * tests exercise both dialects); we never touch `db.raw` (no parameter binding) or `db.query.*` (the
 * instance is created without a bound schema).
 */

import { and, asc, count, desc, eq, gt, gte, inArray, lt, lte, sql } from 'drizzle-orm';

import type { Entity } from './types.ts';
import type { Column, SQL, SQLWrapper, Table } from 'drizzle-orm';

/** A content row — property-keyed (the Drizzle object keys), exactly what the builder reads and returns. */
export type Row = Record<string, unknown>;

/** A canonical base-10 integer (optionally signed) — the only accepted form for a numeric/bigint id. */
const IS_INTEGER = /^-?\d+$/;

/** A `.returning()`-terminated write, awaited for the affected rows. */
interface Returning {
	returning(): PromiseLike<Row[]>;
}

/** The chainable, awaitable select builder (order-independent `where`/`orderBy`/`limit`/`offset`). */
interface SelectBuilder extends PromiseLike<Row[]> {
	from(table: Table): SelectBuilder;
	where(condition: SQL): SelectBuilder;
	/** Takes every ordering term at once — calling it twice REPLACES the order rather than appending. */
	orderBy(...terms: (Column | SQL)[]): SelectBuilder;
	limit(limit: number): SelectBuilder;
	offset(offset: number): SelectBuilder;
}

/** The dialect-agnostic slice of the Drizzle core query builder the content API uses. */
export interface ContentDb {
	/** Projects the given expressions, or the whole row when called bare. */
	select(fields?: Record<string, SQLWrapper>): SelectBuilder;
	insert(table: Table): { values(values: Row): Returning };
	update(table: Table): { set(values: Row): { where(condition: SQL): Returning } };
	delete(table: Table): { where(condition: SQL): Returning };
	/** Runs `fn` against a transaction-bound builder, so its statements share one consistent read. */
	transaction<T>(fn: (tx: ContentDb) => Promise<T>): Promise<T>;
}

/** A page of rows and, when it was asked for, the total matching the same filters. */
export interface RowPage {
	/** The rows for this page. */
	readonly rows: Row[];
	/** Total rows matching the filters, or `null` when the caller did not request a count. */
	readonly total: number | null;
}

/**
 * Reads one page of an entity, optionally with the total matching the same filters.
 *
 * When a count is requested both statements run in ONE transaction, so they observe the same snapshot.
 * Issued concurrently on a pooled connection they would not: a delete landing between them yields an
 * envelope that contradicts itself — ten rows reported alongside a total of three, from which a pager
 * computes a negative page count.
 *
 * The count is opt-in because it doubles the cost of the hottest endpoint in the product, and a filtered
 * scan pays for that scan twice. Only a paginated view actually needs it.
 *
 * @param db - The content database.
 * @param entity - The target entity.
 * @param query - The filters, ordering and page window.
 * @param withCount - Whether to also count the matching rows.
 * @returns The page, with `total` set only when requested.
 */
export async function readRowPage(
	db: ContentDb,
	entity: Entity,
	query: ListQuery,
	withCount: boolean,
): Promise<RowPage> {
	if (!withCount) return { rows: await listRows(db, entity, query), total: null };

	return db.transaction(async (tx) => ({
		rows: await listRows(tx, entity, query),
		total: await countRows(tx, entity, query.filters),
	}));
}

/** How a list request is narrowed, ordered and paged. */
export interface ListQuery {
	/** Max rows to return. */
	readonly limit: number;
	/** Rows to skip. */
	readonly offset: number;
	/** The column to order by; the primary key when absent. */
	readonly sort?: Column | undefined;
	/** The sort direction. */
	readonly direction?: 'asc' | 'desc' | undefined;
	/** Conditions every returned row must satisfy. */
	readonly filters?: readonly SQL[] | undefined;
}

/**
 * Combines filter conditions into one, or `undefined` when there are none — so a caller can decide
 * whether to apply `where` at all rather than passing a vacuous condition.
 *
 * @param filters - The individual conditions.
 * @returns The combined condition, or `undefined` when the list is empty.
 */
function combineFilters(filters: readonly SQL[] | undefined): SQL | undefined {
	if (!filters || filters.length === 0) return undefined;
	return filters.length === 1 ? filters[0] : and(...filters);
}

/**
 * Lists rows from an entity: filtered, ordered and paginated.
 *
 * Ordering falls back to the primary key so `limit`/`offset` paging is deterministic and identical
 * across dialects (physical row order is engine-defined and unstable otherwise). An explicit sort on a
 * non-unique column keeps that fallback as a tiebreaker, for the same reason.
 *
 * @param db - The content database.
 * @param entity - The target entity.
 * @param query - The filters, ordering and page window.
 * @returns The page of rows.
 */
export async function listRows(db: ContentDb, entity: Entity, query: ListQuery): Promise<Row[]> {
	const condition = combineFilters(query.filters);
	const selection = db.select().from(entity.table);
	const filtered = condition ? selection.where(condition) : selection;
	const ordered = applyOrder(filtered, entity, query);
	return ordered.limit(query.limit).offset(query.offset);
}

/**
 * Applies ordering to a selection: the requested column and direction, then the primary key as a
 * tiebreaker so equal values never page unpredictably.
 *
 * @param selection - The selection to order.
 * @param entity - The target entity.
 * @param query - The list query carrying sort column and direction.
 * @returns The ordered selection.
 */
function applyOrder(selection: SelectBuilder, entity: Entity, query: ListQuery): SelectBuilder {
	const direction = query.direction === 'desc' ? desc : asc;
	const terms: (Column | SQL)[] = [];
	const sortName = query.sort?.name;

	if (query.sort) terms.push(direction(query.sort));

	// EVERY key column breaks ties, not just a single-column primary key. A composite-key table — a
	// junction, most often — still serves a list route, and without a tiebreaker its paging has no
	// ORDER BY at all: physical row order is engine-defined and shifts under VACUUM or a plan change, so
	// pages silently drop and repeat rows while the total reports success.
	for (const key of tiebreakerColumns(entity)) {
		// Compared by name rather than identity: a table-level `primaryKey({ columns })` can hand back a
		// different object than the columns map holds, which would emit the same term twice.
		if (key.name === sortName) continue;
		terms.push(query.sort ? asc(key) : direction(key));
	}

	// One call with every term: a second `orderBy` would discard the first rather than extend it.
	return terms.length > 0 ? selection.orderBy(...terms) : selection;
}

/**
 * The columns that make a row's ordering unique: the primary key, however it was declared.
 *
 * @param entity - The target entity.
 * @returns The key columns, empty when the table has no key at all.
 */
function tiebreakerColumns(entity: Entity): Column[] {
	if (entity.pk) return [entity.pk];
	return entity.primaryKeyColumns
		.map((key) => entity.columns[key])
		.filter((column): column is Column => column !== undefined);
}

/**
 * Counts the rows a list query matches, ignoring its page window — the total a pager needs.
 *
 * Must be issued inside the SAME transaction as the list it accompanies. Identical predicates do not
 * imply identical results at different points in time: run concurrently on a pooled connection, a
 * delete landing between the two produces an envelope that contradicts itself — ten rows reported as a
 * total of three, from which a pager computes a negative page count.
 *
 * @param db - The content database.
 * @param entity - The target entity.
 * @param filters - The same conditions applied to the list.
 * @returns The number of matching rows.
 */
export async function countRows(
	db: ContentDb,
	entity: Entity,
	filters?: readonly SQL[],
): Promise<number> {
	const condition = combineFilters(filters);
	const selection = db.select({ value: count() }).from(entity.table);
	const rows = await (condition ? selection.where(condition) : selection);
	// Postgres can return an aggregate as a string; normalise before it reaches the envelope.
	return Number(rows[0]?.value ?? 0);
}

/**
 * Fetches one row by primary key.
 *
 * @param db - The content database.
 * @param entity - The target entity (must have a single-column PK).
 * @param id - The coerced primary-key value.
 * @returns The row, or `undefined` when none matches.
 */
export async function getRow(
	db: ContentDb,
	entity: Entity,
	id: string | number | bigint,
): Promise<Row | undefined> {
	if (!entity.pk) return undefined;
	const rows = await db.select().from(entity.table).where(eq(entity.pk, id)).limit(1);
	return rows.at(0);
}

/**
 * Inserts a row and returns the created record.
 *
 * @param db - The content database.
 * @param entity - The target entity.
 * @param values - The column values (already filtered to known columns).
 * @returns The created row.
 * @throws {Error} When the insert unexpectedly returns no row.
 */
export async function createRow(db: ContentDb, entity: Entity, values: Row): Promise<Row> {
	const [row] = await db.insert(entity.table).values(values).returning();
	if (!row) throw new Error(`insert into "${entity.name}" returned no row`);
	return row;
}

/**
 * Updates a row by primary key.
 *
 * @param db - The content database.
 * @param entity - The target entity (must have a single-column PK).
 * @param id - The coerced primary-key value.
 * @param values - The column values to set (filtered; PK excluded).
 * @returns The updated row, or `undefined` when none matches.
 */
export async function updateRow(
	db: ContentDb,
	entity: Entity,
	id: string | number | bigint,
	values: Row,
): Promise<Row | undefined> {
	if (!entity.pk) return undefined;
	const rows = await db.update(entity.table).set(values).where(eq(entity.pk, id)).returning();
	return rows.at(0);
}

/**
 * Deletes a row by primary key.
 *
 * @param db - The content database.
 * @param entity - The target entity (must have a single-column PK).
 * @param id - The coerced primary-key value.
 * @returns `true` when a row was deleted, `false` when none matched.
 */
export async function deleteRow(
	db: ContentDb,
	entity: Entity,
	id: string | number | bigint,
): Promise<boolean> {
	if (!entity.pk) return false;
	const rows = await db.delete(entity.table).where(eq(entity.pk, id)).returning();
	return rows.length > 0;
}

/**
 * Coerces a URL `:id` string to the primary key's type, so it binds correctly and cannot silently
 * select the wrong row. Drizzle's `dataType` categorizes the column (with a width suffix, e.g.
 * `number int53`, `bigint int64`):
 * - `number` columns require a **canonical, safe** integer (`Number()` alone accepts `0x10`, `1e3`,
 *   floats, and rounds values past 2^53 to a neighbouring id — a wrong-row hazard). A non-canonical
 *   or unsafe value is a bad request.
 * - `bigint` columns bind a `BigInt` (no precision loss); the string must be all digits.
 * - other columns (text/uuid) use the string as-is.
 *
 * @param entity - The target entity.
 * @param raw - The raw `:id` path segment.
 * @returns `{ ok: true, value }` on success, `{ ok: false }` when there is no PK or the id is malformed.
 */
export function coerceId(
	entity: Entity,
	raw: string,
): { ok: true; value: string | number | bigint } | { ok: false } {
	if (!entity.pk) return { ok: false };
	const category = entity.pk.dataType;

	if (category.startsWith('bigint')) {
		if (!IS_INTEGER.test(raw)) return { ok: false };
		return { ok: true, value: BigInt(raw) };
	}
	if (category.startsWith('number')) {
		if (!IS_INTEGER.test(raw)) return { ok: false };
		const value = Number(raw);
		if (!Number.isSafeInteger(value)) return { ok: false };
		return { ok: true, value };
	}
	return { ok: true, value: raw };
}

/** The comparisons a list filter may express, keyed by the operator written in the query string. */
const COMPARISONS = { eq, gt, gte, lt, lte } as const;

/** Text comparisons, which build their own pattern rather than binding the raw value. */
const TEXT_OPERATORS = ['contains', 'startsWith', 'endsWith'] as const;

/**
 * A filter operator.
 *
 * Deliberately small, and two omissions are decisions rather than gaps. There is no raw `like`: its
 * `%`/`_` wildcards would be caller-controlled, an unanchored leading wildcard is a guaranteed
 * sequential scan, and its case sensitivity differs between Postgres and SQLite — `contains` and
 * friends escape the pattern and behave identically on both. There is no `ne` either: `x <> 'a'`
 * silently excludes rows where `x` is NULL, so `count(eq) + count(ne)` would not equal the total, and a
 * subtly wrong operator is worse than a missing one. Both can be added additively.
 */
export type FilterOperator = keyof typeof COMPARISONS | (typeof TEXT_OPERATORS)[number] | 'in';

/** Characters that are wildcards inside a SQL `LIKE` pattern and must be escaped in a literal search. */
const LIKE_WILDCARD = /[\\%_]/g;

/**
 * Whether a string names a filter operator.
 *
 * @param value - The candidate operator.
 * @returns `true` when it is one Glaze implements.
 */
export function isFilterOperator(value: string): value is FilterOperator {
	return value === 'in' || value in COMPARISONS || TEXT_OPERATORS.includes(value as never);
}

/**
 * Escapes a caller's text so it matches literally inside a `LIKE` pattern.
 *
 * Without this a search for `50%` silently matches everything beginning `50`, and a caller has no way
 * to search for a percent sign at all.
 *
 * @param raw - The caller's search text.
 * @returns The text with `LIKE` metacharacters escaped.
 */
function escapeLikePattern(raw: string): string {
	return raw.replace(LIKE_WILDCARD, (character) => `\\${character}`);
}

/**
 * Coerces a raw query-string value to its column's JS type, so it binds as the right type rather than
 * being compared as text.
 *
 * Held to the same standard as {@link coerceId}, and for the same reason: a value that silently becomes
 * a different number selects different rows. A non-integer or unsafe value against an integer column is
 * rejected rather than truncated — Postgres would reject it at the driver anyway, so accepting it would
 * mean the same request succeeded on SQLite and 500'd on Postgres.
 *
 * @param column - The column being compared.
 * @param raw - The raw query-string value.
 * @returns `{ ok: true, value }` on success, `{ ok: false }` when the value cannot be that type.
 */
export function coerceValue(
	column: Column,
	raw: string,
): { ok: true; value: unknown } | { ok: false } {
	const category = column.dataType;

	if (category.startsWith('bigint')) {
		if (!IS_INTEGER.test(raw)) return { ok: false };
		return { ok: true, value: BigInt(raw) };
	}
	if (category.startsWith('number')) return coerceNumber(column, raw);
	if (category.startsWith('boolean')) {
		if (raw !== 'true' && raw !== 'false') return { ok: false };
		return { ok: true, value: raw === 'true' };
	}
	if (
		category.startsWith('object date') ||
		category.includes('date') ||
		category.includes('time')
	) {
		return coerceDate(raw);
	}
	return { ok: true, value: raw };
}

/**
 * Coerces a value for a numeric column, allowing fractions only where the column stores them.
 *
 * @param column - The numeric column.
 * @param raw - The raw query-string value.
 * @returns The coerced number, or a rejection.
 */
function coerceNumber(column: Column, raw: string): { ok: true; value: unknown } | { ok: false } {
	// `Number('')` and `Number(' ')` are both 0, which would silently match the wrong rows.
	if (raw.trim() !== raw || raw === '') return { ok: false };

	if (!acceptsFractions(column)) {
		// Integer column: the same canonical, safe-range rule ids are held to. `0x10`, `1e3` and values
		// past 2^53 all select a row the caller did not ask for.
		if (!IS_INTEGER.test(raw)) return { ok: false };
		const value = Number(raw);
		return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false };
	}

	const value = Number(raw);
	return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

/**
 * Whether a numeric column stores fractional values. Read from the column type because the data type
 * does not say: `numeric({ mode: 'number' })` reports a bare `number`.
 *
 * @param column - The column.
 * @returns `true` when fractions are storable.
 */
function acceptsFractions(column: Column): boolean {
	return FRACTIONAL_COLUMN_TYPES.some((marker) => column.columnType.includes(marker));
}

/** Column-type markers for columns that store fractional values. */
const FRACTIONAL_COLUMN_TYPES = ['Numeric', 'Decimal', 'Real', 'Double', 'Float'];

/**
 * Coerces a value for a date column, rejecting the loose forms `Date` otherwise accepts — `new Date('1')`
 * is a valid date in 2001, so an unguarded parse turns a typo into a plausible-looking filter.
 *
 * @param raw - The raw query-string value.
 * @returns The coerced date, or a rejection.
 */
function coerceDate(raw: string): { ok: true; value: unknown } | { ok: false } {
	// Require at least a full date; anything shorter is far more likely a mistake than an intent.
	if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return { ok: false };
	const value = new Date(raw);
	return Number.isNaN(value.getTime()) ? { ok: false } : { ok: true, value };
}

/** The most values an `in` filter may carry, bounding both bind parameters and plan size. */
const MAX_IN_VALUES = 100;

/**
 * Builds one filter condition from a column, an operator and a raw value.
 *
 * @param column - The column to compare.
 * @param operator - The comparison to apply.
 * @param raw - The raw query-string value; `in` reads it as a comma-separated list.
 * @returns The condition, or `undefined` when the value is not valid for the column and operator.
 */
export function buildFilter(
	column: Column,
	operator: FilterOperator,
	raw: string,
): SQL | undefined {
	if (operator === 'in') return buildInFilter(column, raw);
	if (TEXT_OPERATORS.includes(operator as never)) return buildTextFilter(column, operator, raw);

	const coerced = coerceValue(column, raw);
	if (!coerced.ok) return undefined;
	return COMPARISONS[operator as keyof typeof COMPARISONS](column, coerced.value);
}

/**
 * Builds an `IN` condition from a comma-separated list, bounded so one request cannot exhaust the
 * driver's bind-parameter budget (Postgres caps a statement at 65535) or force a pathological plan.
 *
 * @param column - The column to compare.
 * @param raw - The comma-separated values.
 * @returns The condition, or `undefined` when any value is invalid or the list is empty or too long.
 */
function buildInFilter(column: Column, raw: string): SQL | undefined {
	if (raw === '') return undefined;
	const parts = raw.split(',');
	if (parts.length > MAX_IN_VALUES) return undefined;

	const values: unknown[] = [];
	for (const part of parts) {
		const coerced = coerceValue(column, part);
		if (!coerced.ok) return undefined;
		values.push(coerced.value);
	}
	return inArray(column, values);
}

/**
 * Builds a text-search condition. The caller's text is escaped and the pattern anchored by Glaze, so
 * wildcards are never caller-supplied, and both sides are lowercased so the result does not depend on
 * the engine's collation — Postgres `LIKE` matches case, SQLite's does not.
 *
 * @param column - The column to search.
 * @param operator - Which end of the value to anchor to.
 * @param raw - The caller's search text.
 * @returns The condition, or `undefined` when the column does not hold text.
 */
function buildTextFilter(column: Column, operator: string, raw: string): SQL | undefined {
	// A text comparison against a number or date is a caller error, and errors at the driver on Postgres.
	if (!column.dataType.startsWith('string')) return undefined;

	const escaped = escapeLikePattern(raw);
	const pattern =
		operator === 'startsWith'
			? `${escaped}%`
			: operator === 'endsWith'
				? `%${escaped}`
				: `%${escaped}%`;
	return sql`lower(${column}) like lower(${pattern}) escape '\\'`;
}
