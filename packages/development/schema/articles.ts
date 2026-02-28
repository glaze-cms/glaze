/**
 * Synced from database via Glaze Admin.
 * Indexes/constraints (including FKs) are preserved.
 *
 * For Drizzle's relational query API: create relations.ts
 * https://orm.drizzle.team/docs/relations-v2
 */
import { pgTable, uuid, text } from 'drizzle-orm/pg-core';

export const articles = pgTable('articles', {
	id: uuid().primaryKey(),
	title: text().notNull(),
	content: text(),
});
