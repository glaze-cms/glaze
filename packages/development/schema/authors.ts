/**
 * Synced from database via Glaze Admin.
 * Indexes/constraints (including FKs) are preserved.
 *
 * For Drizzle's relational query API: create relations.ts
 * https://orm.drizzle.team/docs/relations-v2
 */
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const authors = pgTable('authors', {
	id: uuid().defaultRandom().primaryKey(),
	name: text().notNull(),
	email: text().notNull(),
	bio: text(),
	createdAt: timestamp('created_at').default(sql`now()`),
	updatedAt: timestamp('updated_at').default(sql`now()`),
});
