/**
 * Synced from database via Glaze Admin.
 * Indexes/constraints (including FKs) are preserved.
 *
 * For Drizzle's relational query API: create relations.ts
 * https://orm.drizzle.team/docs/relations-v2
 */
import { pgTable, uuid, text, timestamp, integer, primaryKey, unique } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { authors } from './authors';

export const posts = pgTable("posts", {
	id: uuid().defaultRandom().primaryKey(),
	title: text().notNull(),
	slug: text().notNull(),
	content: text().notNull(),
	status: text().default("draft"),
	createdAt: timestamp("created_at").default(sql`now()`),
	updatedAt: timestamp("updated_at").default(sql`now()`),
	authorId: uuid("author_id").notNull().references(() => authors.id),
	softDeletedAt: timestamp("soft_deleted_at"),
	views: integer().default(0),
}, (table) => [
	unique("posts_slug_key").on(table.slug),]);