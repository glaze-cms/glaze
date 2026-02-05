import {
	pgTable,
	uuid,
	text,
	timestamp,
	unique,
	integer,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const posts = pgTable(
	'posts',
	{
		id: uuid().defaultRandom().primaryKey(),
		title: text().notNull(),
		slug: text().notNull(),
		content: text().notNull(),
		status: text().default('draft'),
		createdAt: timestamp('created_at').default(sql`now()`),
		updatedAt: timestamp('updated_at').default(sql`now()`),
		authorId: uuid('author_id').notNull(),
		softDeletedAt: timestamp('soft_deleted_at'),
		views: integer('views').default(0),
	},
	(table) => [unique('posts_slug_key').on(table.slug)],
);
