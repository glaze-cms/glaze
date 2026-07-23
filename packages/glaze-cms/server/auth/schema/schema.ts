/**
 * The auth database schema — Glaze's internal identity tables (`user`/`session`/`account`/
 * `verification`), hand-written as dialect-aware Drizzle tables and namespaced away from user content:
 * a `glaze_auth` Postgres schema, or a `zz__glaze_auth_` table prefix on SQLite (schemaless, so the
 * prefix both namespaces and sorts the tables last for DX).
 *
 * The returned object is keyed by Better Auth's **singular model names** — `drizzleAdapter` resolves a
 * model by looking up `schema[model]`, so the keys must be the model names; the physical table names
 * are Glaze's namespacing concern. Authentication only: there is intentionally **no `role` column** or
 * any other RBAC field (deferred).
 */

import { boolean, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
import { integer, sqliteTable, text as sqliteText } from 'drizzle-orm/sqlite-core';

import type { Dialect } from '#dialect';

/** Better Auth's core model names — the keys `drizzleAdapter` resolves against the schema object. */
export type AuthModelName = 'user' | 'session' | 'account' | 'verification';

/** The auth schema: one Drizzle table per Better Auth model, keyed by model name. */
export type AuthSchema = Record<AuthModelName, unknown>;

/** The Postgres schema (namespace) Glaze's auth tables live in, keeping `public` for user content. */
export const AUTH_PG_SCHEMA = 'glaze_auth';

/** The SQLite table-name prefix that namespaces (and sorts-last) Glaze's auth tables. */
export const AUTH_SQLITE_PREFIX = 'zz__glaze_auth_';

/**
 * The DB column names Better Auth v1.6.x requires on each core model (snake_case). The single source
 * for the shape-guard test — if a Better Auth upgrade changes the contract, that test fails loudly in
 * the gate. Deliberately excludes any `role`/RBAC column.
 */
export const AUTH_EXPECTED_COLUMNS: Record<AuthModelName, readonly string[]> = {
	user: ['id', 'name', 'email', 'email_verified', 'image', 'created_at', 'updated_at'],
	session: [
		'id',
		'expires_at',
		'token',
		'created_at',
		'updated_at',
		'ip_address',
		'user_agent',
		'user_id',
	],
	account: [
		'id',
		'account_id',
		'provider_id',
		'user_id',
		'access_token',
		'refresh_token',
		'id_token',
		'access_token_expires_at',
		'refresh_token_expires_at',
		'scope',
		'password',
		'created_at',
		'updated_at',
	],
	verification: ['id', 'identifier', 'value', 'expires_at', 'created_at', 'updated_at'],
};

/**
 * Builds the dialect-correct auth schema for materialization + the Better Auth adapter.
 *
 * @param dialect - The target database dialect.
 * @returns The auth tables keyed by Better Auth model name.
 */
export function buildAuthSchema(dialect: Dialect): AuthSchema {
	return dialect === 'postgres' ? buildPostgresAuthSchema() : buildSqliteAuthSchema();
}

/**
 * Builds the Postgres auth schema in the `glaze_auth` namespace.
 *
 * @returns The Postgres auth tables keyed by Better Auth model name.
 */
function buildPostgresAuthSchema(): AuthSchema {
	const authSchema = pgSchema(AUTH_PG_SCHEMA);

	const user = authSchema.table('users', {
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		email: text('email').notNull().unique(),
		emailVerified: boolean('email_verified').notNull().default(false),
		image: text('image'),
		createdAt: timestamp('created_at').notNull(),
		updatedAt: timestamp('updated_at').notNull(),
	});

	const session = authSchema.table('sessions', {
		id: text('id').primaryKey(),
		expiresAt: timestamp('expires_at').notNull(),
		token: text('token').notNull().unique(),
		createdAt: timestamp('created_at').notNull(),
		updatedAt: timestamp('updated_at').notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
	});

	const account = authSchema.table('accounts', {
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at'),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
		scope: text('scope'),
		password: text('password'),
		createdAt: timestamp('created_at').notNull(),
		updatedAt: timestamp('updated_at').notNull(),
	});

	const verification = authSchema.table('verifications', {
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').notNull(),
		updatedAt: timestamp('updated_at').notNull(),
	});

	return { user, session, account, verification };
}

/**
 * Builds the SQLite auth schema with the `zz__glaze_auth_` table prefix. Dates are stored as
 * integer Unix timestamps and booleans as integers (Better Auth passes/reads `Date`/`boolean`,
 * which Drizzle's `timestamp`/`boolean` modes convert).
 *
 * @returns The SQLite auth tables keyed by Better Auth model name.
 */
function buildSqliteAuthSchema(): AuthSchema {
	const user = sqliteTable(`${AUTH_SQLITE_PREFIX}users`, {
		id: sqliteText('id').primaryKey(),
		name: sqliteText('name').notNull(),
		email: sqliteText('email').notNull().unique(),
		emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
		image: sqliteText('image'),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
	});

	const session = sqliteTable(`${AUTH_SQLITE_PREFIX}sessions`, {
		id: sqliteText('id').primaryKey(),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		token: sqliteText('token').notNull().unique(),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
		ipAddress: sqliteText('ip_address'),
		userAgent: sqliteText('user_agent'),
		userId: sqliteText('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
	});

	const account = sqliteTable(`${AUTH_SQLITE_PREFIX}accounts`, {
		id: sqliteText('id').primaryKey(),
		accountId: sqliteText('account_id').notNull(),
		providerId: sqliteText('provider_id').notNull(),
		userId: sqliteText('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: sqliteText('access_token'),
		refreshToken: sqliteText('refresh_token'),
		idToken: sqliteText('id_token'),
		accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
		refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
		scope: sqliteText('scope'),
		password: sqliteText('password'),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
	});

	const verification = sqliteTable(`${AUTH_SQLITE_PREFIX}verifications`, {
		id: sqliteText('id').primaryKey(),
		identifier: sqliteText('identifier').notNull(),
		value: sqliteText('value').notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
	});

	return { user, session, account, verification };
}
