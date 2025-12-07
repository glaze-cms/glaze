import { pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Blog posts table
 */
export const posts = pgTable('posts', {
	id: serial('id').primaryKey(),
	title: varchar('title', { length: 255 }).notNull(),
	slug: varchar('slug', { length: 255 }).notNull().unique(),
	content: text('content'),
	status: varchar('status', { length: 20 }).default('draft'),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
});
