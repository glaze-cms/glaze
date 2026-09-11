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

/**
 * What sort of thing acted. `system` is Glaze itself, reconciling a request without being a
 * principal — the reason `actorId` is nullable.
 *
 * There is deliberately no `agent`: an agent acts **as** a user, so an approval it makes is that
 * person's, recorded under their id. Nothing can write `agent` today, and a union member that cannot
 * occur tells every reader that agent-actors exist and need handling. The column is plain text, so
 * the value comes back as a one-line change if an agent ever gets an identity of its own.
 */
export type ActorKind = 'user' | 'system';

/**
 * What a principal may do. `user` is the floor every account stands on the moment it exists: it can
 * sign in and nothing more. It is never written to `principals` — a row there is a grant of something
 * above the floor, so an account with no row is a `user` by definition, and nothing has to run at
 * sign-up for that to be true.
 *
 * The real policy model replaces the column, not the table: three values in a text column cannot
 * express permissions scoped to a resource, or `propose` held apart from `approve` (AGENTS.md §1).
 */
export type PrincipalRole = 'admin' | 'editor' | 'user';

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

	// One row per grant above `user`; an account with no row is a `user`.
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

	// One row per grant above `user`; an account with no row is a `user`.
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
 * omission. An event must outlive the account that caused it: with a foreign key, deleting a user
 * either cascades and destroys the audit trail, or blocks and makes it impossible to offboard
 * anybody. Without one, the trail still says who dropped the column long after they left.
 *
 * The role lives here rather than on the Better Auth user table for a different reason: the sign-up
 * endpoint must not be able to say "I am admin". A table Better Auth knows nothing about has no
 * field to express it, so the guarantee is structural rather than a check somebody has to remember.
 * (The auth schema also has a shape-guard test asserting it carries no RBAC column.)
 *
 * @param dialect - The target database dialect.
 * @returns The approvals tables.
 */
export function buildApprovalSchema(dialect: Dialect): ApprovalSchema {
	return dialect === 'postgres' ? buildPostgresApprovalSchema() : buildSqliteApprovalSchema();
}
