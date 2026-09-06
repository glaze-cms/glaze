/**
 * Reading and writing the approvals trail.
 *
 * Every write is an append — nothing here updates or deletes a row, so the trail cannot be edited
 * into a shape that suits whoever is looking at it. A request's state is derived by reading its
 * latest event, never stored beside it.
 *
 * Queries go through Drizzle's core query builder for the same reason the content API does:
 * `db.raw` has no parameter binding, and a rejection reason is text a person typed. See
 * `server/content/handlers.ts` for the documented dialect-agnostic cast this mirrors.
 */

import { desc, eq, sql } from 'drizzle-orm';

import { createTrailId } from './id.ts';

import type { ActorKind, ApprovalEventType, PrincipalRole } from './schema/index.ts';
import type { Column, SQL, SQLWrapper, Table } from 'drizzle-orm';

/** A trail row, property-keyed exactly as the Drizzle builder reads and returns it. */
type Row = Record<string, unknown>;

/** The chainable, awaitable select builder (order-independent `where`/`orderBy`/`limit`). */
interface SelectBuilder extends PromiseLike<Row[]> {
	from(table: Table): SelectBuilder;
	where(condition: SQL): SelectBuilder;
	orderBy(...terms: (Column | SQL)[]): SelectBuilder;
	limit(limit: number): SelectBuilder;
}

/** The dialect-agnostic slice of the Drizzle core query builder the approvals trail uses. */
export interface ApprovalDb {
	select(fields?: Record<string, SQLWrapper>): SelectBuilder;
	insert(table: Table): { values(values: Row): PromiseLike<unknown> };
	/** Runs `fn` inside one transaction, so a pair of appends cannot half-happen. */
	transaction<T>(fn: (tx: ApprovalDb) => Promise<T>): Promise<T>;
}

/** What one appended event says. The id and instant are the store's to assign. */
export interface ApprovalEventInput {
	/** The request this event belongs to. */
	readonly requestId: string;
	/** What happened. */
	readonly type: ApprovalEventType;
	/** The change's fingerprint. Set on `requested`; absent on every other type. */
	readonly changeHash?: string;
	/** Who acted, or absent when Glaze itself did. */
	readonly actorId?: string;
	/** What sort of thing acted. */
	readonly actorKind: ActorKind;
	/** Type-specific detail — statements, findings, a rejection reason. */
	readonly payload?: unknown;
}

/** An approval request with no terminal event yet: the one thing a person still has to decide. */
export interface OpenRequest {
	/** The request id, to append its decision to. */
	readonly requestId: string;
	/** The fingerprint of the change it describes. */
	readonly changeHash: string;
	/** When it was filed. */
	readonly createdAt: Date;
	/** The `requested` payload — statements, findings, description. */
	readonly payload: unknown;
}

/** A trail row as read back, before it is interpreted. */
interface EventRow {
	readonly id: string;
	readonly requestId: string;
	readonly type: string;
	readonly changeHash: string | null;
	readonly createdAt: Date | number;
	readonly payload: unknown;
}

/**
 * Reads a value that may arrive as a `Date` (Postgres) or epoch milliseconds (SQLite).
 *
 * @param value - The stored instant.
 * @returns The instant as a `Date`.
 */
function toDate(value: Date | number): Date {
	return value instanceof Date ? value : new Date(value);
}

/**
 * Removes NUL characters from every string in a payload.
 *
 * Postgres `jsonb` rejects `\u0000` inside a string; SQLite's JSON text stores it happily. A payload
 * can carry one — findings quote raw database error text, and this codebase NUL-joins keys on
 * purpose — so without this the same event writes on one dialect and fails boot on the other.
 * Dropping the character loses nothing a person would read.
 *
 * @param value - Any payload value.
 * @returns The value with NUL characters removed from its strings.
 */
function stripNuls(value: unknown): unknown {
	if (typeof value === 'string') return value.replaceAll('\u0000', '');
	if (Array.isArray(value)) return value.map(stripNuls);
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripNuls(item)]));
	}
	return value;
}

/**
 * Appends one event to the trail.
 *
 * @param db - The query builder.
 * @param table - The `approval_events` table.
 * @param event - What happened.
 * @returns The id of the appended event.
 */
export async function recordEvent(
	db: ApprovalDb,
	table: Table,
	event: ApprovalEventInput,
): Promise<string> {
	const id = createTrailId();
	await db.insert(table).values({
		id,
		requestId: event.requestId,
		type: event.type,
		changeHash: event.changeHash ?? null,
		actorId: event.actorId ?? null,
		actorKind: event.actorKind,
		createdAt: new Date(),
		payload: stripNuls(event.payload ?? null),
	});
	return id;
}

/**
 * Finds the request still waiting on a person, if there is one.
 *
 * A request is open when its **latest** event is `requested`, so the query asks for exactly that: a
 * `requested` event with nothing after it on the same request. Checking only the newest `requested`
 * event in the table would be shorter and wrong — it assumes one request at a time. That holds for
 * the `dev` origin today, and stops holding the moment the `ui` origin can file its own, at which
 * point an older request would silently become invisible rather than merely unsupported.
 *
 * @param db - The query builder.
 * @param table - The `approval_events` table.
 * @returns The open request, or `null` when nothing is pending.
 */
export async function findOpenRequest(db: ApprovalDb, table: Table): Promise<OpenRequest | null> {
	const columns = table as unknown as Record<string, Column>;
	const id = columns['id'] as Column;
	const requestId = columns['requestId'] as Column;

	const rows = (await db
		.select()
		.from(table)
		.where(
			sql`${eq(columns['type'] as Column, 'requested')} and not exists (select 1 from ${table} as later where later."request_id" = ${requestId} and later."id" > ${id})`,
		)
		.orderBy(desc(id))
		.limit(1)) as unknown as EventRow[];

	const open = rows[0];
	if (!open) return null;

	return {
		requestId: open.requestId,
		changeHash: open.changeHash ?? '',
		createdAt: toDate(open.createdAt),
		payload: open.payload,
	};
}

/**
 * Reads a principal's role.
 *
 * @param db - The query builder.
 * @param table - The `principals` table.
 * @param userId - The account to look up.
 * @returns The role, or `null` when the account has none.
 */
export async function findRole(
	db: ApprovalDb,
	table: Table,
	userId: string,
): Promise<PrincipalRole | null> {
	const columns = table as unknown as Record<string, Column>;
	const rows = (await db
		.select()
		.from(table)
		.where(eq(columns['userId'] as Column, userId))
		.limit(1)) as unknown as Array<{ role: string }>;

	const role = rows[0]?.role;
	return role === 'admin' || role === 'editor' ? role : null;
}
