/**
 * The pending-approvals schema — Glaze's internal record of structural changes that are waiting for
 * a person, hand-written as dialect-aware Drizzle tables and namespaced away from user content: a
 * `glaze` Postgres schema, or a `zz__glaze_` table prefix on SQLite (schemaless, so the prefix both
 * namespaces and sorts the tables last for DX).
 *
 * `approval_events` is **append-only**: one row per thing that happened, never updated, never
 * deleted. A request's current state is derived from its latest event, so there is no status column
 * to drift out of step with the trail. See `specs/design/pending-approvals.md`.
 */

import { index, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
import {
	index as sqliteIndex,
	integer,
	sqliteTable,
	text as sqliteText,
} from 'drizzle-orm/sqlite-core';

import type { Dialect } from '#dialect';

/** The Postgres schema (namespace) Glaze's own tables live in, keeping `public` for user content. */
export const GLAZE_PG_SCHEMA = 'glaze';

/** The SQLite table-name prefix that namespaces (and sorts-last) Glaze's own tables. */
export const GLAZE_SQLITE_PREFIX = 'zz__glaze_';

/**
 * What happened to an approval request. `requested` opens it and every other type closes it —
 * `apply_failed` included, because the change is still in the schema file and the next boot files a
 * fresh request rather than retrying a failed apply.
 */
export type ApprovalEventType =
	| 'requested'
	| 'approved'
	| 'rejected'
	| 'applied'
	| 'apply_failed'
	| 'superseded'
	| 'withdrawn';

/** What sort of thing acted. `system` is Glaze itself, which acts without being a principal. */
export type ActorKind = 'user' | 'agent' | 'system';

/** What a principal may do. Replaced wholesale by the real policy model; see AGENTS.md §1. */
export type PrincipalRole = 'admin' | 'editor';

/**
 * The approvals tables, keyed by name. A type alias rather than an interface so it carries an
 * implicit index signature and satisfies the dialect seam's `Record<string, unknown>` without a cast.
 */
export type ApprovalSchema = {
	readonly approvalEvents: unknown;
	readonly principals: unknown;
};

/**
 * Index names. SQLite has no schemas, so its index namespace is per-database and each name carries
 * the `zz__glaze_` prefix to stay clear of user content. Postgres indexes live inside the `glaze`
 * schema, which is what the prefix substitutes for, so they take the bare name.
 */
const REQUEST_INDEX = 'approval_events_request_id_idx';
/** Index behind reading one request's trail. */
export const APPROVAL_REQUEST_INDEX = `${GLAZE_SQLITE_PREFIX}${REQUEST_INDEX}`;
const TYPE_INDEX = 'approval_events_type_idx';
/** Index behind the open-request lookup, which runs on every boot and filters on `type`. */
export const APPROVAL_TYPE_INDEX = `${GLAZE_SQLITE_PREFIX}${TYPE_INDEX}`;

/**
 * Builds the Postgres approvals tables in the `glaze` namespace.
 *
 * @returns The Postgres approvals tables.
 */
function buildPostgresApprovalSchema(): ApprovalSchema {
	const glaze = pgSchema(GLAZE_PG_SCHEMA);

	const approvalEvents = glaze.table(
		'approval_events',
		{
			id: text('id').primaryKey(),
			requestId: text('request_id').notNull(),
			type: text('type').notNull(),
			changeHash: text('change_hash'),
			actorId: text('actor_id'),
			actorKind: text('actor_kind').notNull(),
			createdAt: timestamp('created_at').notNull(),
			payload: jsonb('payload'),
		},
		(table) => [index(REQUEST_INDEX).on(table.requestId), index(TYPE_INDEX).on(table.type)],
	);

	const principals = glaze.table('principals', {
		userId: text('user_id').primaryKey(),
		role: text('role').notNull(),
		createdAt: timestamp('created_at').notNull(),
	});

	return { approvalEvents, principals };
}

/**
 * Builds the SQLite approvals tables with the `zz__glaze_` table prefix. The payload is JSON text, as
 * in the auth tables. Dates are stored in **milliseconds** rather than the auth tables' seconds: the
 * trail records several events per boot, and second precision would show them as simultaneous.
 *
 * @returns The SQLite approvals tables.
 */
function buildSqliteApprovalSchema(): ApprovalSchema {
	const approvalEvents = sqliteTable(
		`${GLAZE_SQLITE_PREFIX}approval_events`,
		{
			id: sqliteText('id').primaryKey(),
			requestId: sqliteText('request_id').notNull(),
			type: sqliteText('type').notNull(),
			changeHash: sqliteText('change_hash'),
			actorId: sqliteText('actor_id'),
			actorKind: sqliteText('actor_kind').notNull(),
			createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
			payload: sqliteText('payload', { mode: 'json' }),
		},
		(table) => [
			sqliteIndex(APPROVAL_REQUEST_INDEX).on(table.requestId),
			sqliteIndex(APPROVAL_TYPE_INDEX).on(table.type),
		],
	);

	const principals = sqliteTable(`${GLAZE_SQLITE_PREFIX}principals`, {
		userId: sqliteText('user_id').primaryKey(),
		role: sqliteText('role').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	});

	return { approvalEvents, principals };
}

/**
 * Builds the dialect-correct approvals schema for materialization and for querying the trail.
 *
 * Neither table carries a foreign key to the auth tables, and that is deliberate rather than an
 * omission: `actorId` must survive the deletion of the account that acted, or the trail loses
 * exactly the events a deleted account is most interesting for. `principals.userId` is left free of
 * one for the same reason the table exists at all — an agent is never a Better Auth user.
 *
 * @param dialect - The target database dialect.
 * @returns The approvals tables.
 */
export function buildApprovalSchema(dialect: Dialect): ApprovalSchema {
	return dialect === 'postgres' ? buildPostgresApprovalSchema() : buildSqliteApprovalSchema();
}
