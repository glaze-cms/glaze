import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Blog authors. */
export const authors = sqliteTable('authors', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
});

/** Blog posts, each optionally attributed to an author. */
export const posts = sqliteTable('posts', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	title: text('title').notNull(),
	slug: text('slug').notNull().unique(),
	content: text('content'),
	published: integer('published', { mode: 'boolean' }).notNull().default(false),
	authorId: integer('author_id').references(() => authors.id),
	createdAt: text('created_at')
		.notNull()
		.default(sql`(current_timestamp)`),
});
