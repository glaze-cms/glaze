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

import { eq } from 'drizzle-orm';

import type { Collection } from './types.ts';
import type { Column, SQL, Table } from 'drizzle-orm';

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
	orderBy(column: Column): SelectBuilder;
	limit(limit: number): SelectBuilder;
	offset(offset: number): SelectBuilder;
}

/** The dialect-agnostic slice of the Drizzle core query builder the content API uses. */
export interface ContentDb {
	select(): SelectBuilder;
	insert(table: Table): { values(values: Row): Returning };
	update(table: Table): { set(values: Row): { where(condition: SQL): Returning } };
	delete(table: Table): { where(condition: SQL): Returning };
}

/**
 * Lists rows from a collection, paginated.
 *
 * Ordered by the primary key when the collection has one, so `limit`/`offset` paging is deterministic
 * and identical across dialects (physical row order is engine-defined and unstable otherwise).
 *
 * @param db - The content database.
 * @param collection - The target collection.
 * @param limit - Max rows to return.
 * @param offset - Rows to skip.
 * @returns The page of rows.
 */
export async function listRows(
	db: ContentDb,
	collection: Collection,
	limit: number,
	offset: number,
): Promise<Row[]> {
	const selection = db.select().from(collection.table);
	const ordered = collection.pk ? selection.orderBy(collection.pk) : selection;
	return ordered.limit(limit).offset(offset);
}

/**
 * Fetches one row by primary key.
 *
 * @param db - The content database.
 * @param collection - The target collection (must have a single-column PK).
 * @param id - The coerced primary-key value.
 * @returns The row, or `undefined` when none matches.
 */
export async function getRow(
	db: ContentDb,
	collection: Collection,
	id: string | number | bigint,
): Promise<Row | undefined> {
	if (!collection.pk) return undefined;
	const rows = await db.select().from(collection.table).where(eq(collection.pk, id)).limit(1);
	return rows.at(0);
}

/**
 * Inserts a row and returns the created record.
 *
 * @param db - The content database.
 * @param collection - The target collection.
 * @param values - The column values (already filtered to known columns).
 * @returns The created row.
 * @throws {Error} When the insert unexpectedly returns no row.
 */
export async function createRow(db: ContentDb, collection: Collection, values: Row): Promise<Row> {
	const [row] = await db.insert(collection.table).values(values).returning();
	if (!row) throw new Error(`insert into "${collection.name}" returned no row`);
	return row;
}

/**
 * Updates a row by primary key.
 *
 * @param db - The content database.
 * @param collection - The target collection (must have a single-column PK).
 * @param id - The coerced primary-key value.
 * @param values - The column values to set (filtered; PK excluded).
 * @returns The updated row, or `undefined` when none matches.
 */
export async function updateRow(
	db: ContentDb,
	collection: Collection,
	id: string | number | bigint,
	values: Row,
): Promise<Row | undefined> {
	if (!collection.pk) return undefined;
	const rows = await db
		.update(collection.table)
		.set(values)
		.where(eq(collection.pk, id))
		.returning();
	return rows.at(0);
}

/**
 * Deletes a row by primary key.
 *
 * @param db - The content database.
 * @param collection - The target collection (must have a single-column PK).
 * @param id - The coerced primary-key value.
 * @returns `true` when a row was deleted, `false` when none matched.
 */
export async function deleteRow(
	db: ContentDb,
	collection: Collection,
	id: string | number | bigint,
): Promise<boolean> {
	if (!collection.pk) return false;
	const rows = await db.delete(collection.table).where(eq(collection.pk, id)).returning();
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
 * @param collection - The target collection.
 * @param raw - The raw `:id` path segment.
 * @returns `{ ok: true, value }` on success, `{ ok: false }` when there is no PK or the id is malformed.
 */
export function coerceId(
	collection: Collection,
	raw: string,
): { ok: true; value: string | number | bigint } | { ok: false } {
	if (!collection.pk) return { ok: false };
	const category = collection.pk.dataType;

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
