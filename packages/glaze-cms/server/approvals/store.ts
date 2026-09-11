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

import type { Dialect } from '#dialect';
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
	update(table: Table): { set(values: Row): { where(condition: SQL): PromiseLike<unknown> } };
}

/** The Postgres builder's raw-statement entry, used only to take the claim lock. */
interface StatementRunner {
	execute(query: SQL): PromiseLike<unknown>;
}

/**
 * The advisory-lock key the first-admin claim takes on Postgres. Any constant works; it only has to
 * be the same for every claimant and unlikely to collide with somebody else's lock.
 */
const FIRST_ADMIN_LOCK_KEY = 7_212_001;

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

/** The role values this store recognises when reading a row back. Anything else is treated as `user`. */
const GRANTED_ROLES: ReadonlySet<string> = new Set(['admin', 'editor']);

/**
 * Reads a principal's role.
 *
 * An account with no row is a `user`, and so is a row whose value this code does not recognise: an
 * unknown value in the role column is answered with the least privilege, never with a guess.
 *
 * @param db - The query builder.
 * @param table - The `principals` table.
 * @param userId - The account to look up.
 * @returns The role — `user` when the account has been granted nothing.
 */
export async function findRole(
	db: ApprovalDb,
	table: Table,
	userId: string,
): Promise<PrincipalRole> {
	const columns = table as unknown as Record<string, Column>;
	const rows = (await db
		.select()
		.from(table)
		.where(eq(columns['userId'] as Column, userId))
		.limit(1)) as unknown as Array<{ role: string }>;

	const role = rows[0]?.role;
	return role !== undefined && GRANTED_ROLES.has(role) ? (role as PrincipalRole) : 'user';
}

/**
 * Reports whether any account holds `admin`.
 *
 * @param db - The query builder.
 * @param table - The `principals` table.
 * @returns `true` once at least one admin exists.
 */
export async function hasAdmin(db: ApprovalDb, table: Table): Promise<boolean> {
	const columns = table as unknown as Record<string, Column>;
	const rows = await db
		.select()
		.from(table)
		.where(eq(columns['role'] as Column, 'admin'))
		.limit(1);
	return rows.length > 0;
}

/**
 * Makes concurrent claims take turns, so two of them cannot both read "no admin" and both write one.
 *
 * On Postgres each transaction has its own connection, so the read-then-write needs a lock held to
 * the end of the transaction: `pg_advisory_xact_lock` blocks the second claimant until the first has
 * committed, and the second then reads the admin the first wrote. On SQLite the seam runs
 * transactions one at a time on its single connection, which is the same guarantee for free.
 *
 * @param db - The query builder from the surrounding transaction.
 * @param dialect - The dialect the builder speaks.
 */
async function lockFirstAdminClaim(db: ApprovalDb, dialect: Dialect): Promise<void> {
	if (dialect !== 'postgres') return;
	await (db as unknown as StatementRunner).execute(
		sql`select pg_advisory_xact_lock(${sql.raw(String(FIRST_ADMIN_LOCK_KEY))})`,
	);
}

/**
 * Grants `admin` to an account, but only while no admin exists at all.
 *
 * This is the one grant that has no admin to make it, so the empty table stands in for one: the
 * first account to ask is granted, and from then on the answer is `false` for everybody, the admin
 * included. Nothing is written when the answer is `false`. An account that already holds a lesser
 * grant is raised to `admin` rather than refused — the seal is about admins existing, not about the
 * claimant being new.
 *
 * Run it inside `DatabaseHandle.queryTransaction` and pass the builder that transaction hands out:
 * the lock, the read and the write have to share one transaction for "first" to mean anything.
 *
 * @param db - The query builder from the surrounding transaction.
 * @param table - The `principals` table.
 * @param userId - The account asking to be the first admin.
 * @param dialect - The dialect the builder speaks, which decides how claims take turns.
 * @returns `true` when the grant was made; `false` when an admin already existed.
 */
export async function claimFirstAdmin(
	db: ApprovalDb,
	table: Table,
	userId: string,
	dialect: Dialect,
): Promise<boolean> {
	await lockFirstAdminClaim(db, dialect);
	if (await hasAdmin(db, table)) return false;

	const columns = table as unknown as Record<string, Column>;
	const userIdColumn = columns['userId'] as Column;
	const existing = await db.select().from(table).where(eq(userIdColumn, userId)).limit(1);
	if (existing.length > 0) {
		await db.update(table).set({ role: 'admin' }).where(eq(userIdColumn, userId));
	} else {
		await db.insert(table).values({ userId, role: 'admin', createdAt: new Date() });
	}
	return true;
}
