# Glaze CMS V1 - CRUD Generation

## How It Works

Glaze automatically generates RESTful CRUD routes by introspecting your Drizzle schema at startup.

**Key Innovation:** No manual route writing. Define schema once, get full API.

---

## The CRUD Generator

### Implementation

```typescript
// packages/core/src/lib/crud-generator.ts
import { Elysia, t } from 'elysia';
import type { PgTable } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import { db } from '../db/drizzle';

export function generateCRUDRoutes(schema: Record<string, PgTable>) {
	const app = new Elysia({ prefix: '/api' });

	for (const [tableName, table] of Object.entries(schema)) {
		app
			// List all records
			.get(`/${tableName}`, async () => {
				return db.query[tableName].findMany();
			})

			// Get single record
			.get(`/${tableName}/:id`, async ({ params }) => {
				return db.query[tableName].findFirst({
					where: eq(table.id, params.id),
				});
			})

			// Create record
			.post(`/${tableName}`, async ({ body }) => {
				const [record] = await db.insert(table).values(body).returning();
				return record;
			})

			// Update record
			.put(`/${tableName}/:id`, async ({ params, body }) => {
				const [record] = await db
					.update(table)
					.set(body)
					.where(eq(table.id, params.id))
					.returning();
				return record;
			})

			// Delete record
			.delete(`/${tableName}/:id`, async ({ params }) => {
				await db.delete(table).where(eq(table.id, params.id));
				return { success: true };
			});
	}

	return app;
}
```

---

## Generated Routes

For a schema like:

```typescript
export const posts = pgTable('posts', {
	id: uuid('id').primaryKey(),
	title: text('title').notNull(),
});
```

You automatically get:

### List All

```
GET /api/posts
```

**Response:**

```json
[
	{ "id": "uuid1", "title": "Post 1" },
	{ "id": "uuid2", "title": "Post 2" }
]
```

### Get One

```
GET /api/posts/:id
```

**Response:**

```json
{ "id": "uuid1", "title": "Post 1" }
```

### Create

```
POST /api/posts
Content-Type: application/json

{
  "title": "New Post"
}
```

**Response:**

```json
{ "id": "uuid3", "title": "New Post" }
```

### Update

```
PUT /api/posts/:id
Content-Type: application/json

{
  "title": "Updated Title"
}
```

**Response:**

```json
{ "id": "uuid1", "title": "Updated Title" }
```

### Delete

```
DELETE /api/posts/:id
```

**Response:**

```json
{ "success": true }
```

---

## Auth Guards

CRUD routes are automatically protected by auth guards:

```typescript
export function generateCRUDRoutes(schema: Record<string, PgTable>) {
	return (
		new Elysia({ prefix: '/api' })
			// Derive user from Better-Auth session
			.derive(async ({ request }) => {
				const session = await auth.api.getSession({
					headers: request.headers,
				});
				return {
					user: session?.user || null,
					session: session?.session || null,
				};
			})

			// Apply auth guard to mutations
			.guard((app) =>
				app
					.onBeforeHandle(({ user, error }) => {
						if (!user) {
							return error(401, 'Unauthorized');
						}
					})

					// POST, PUT, DELETE require auth
					.post(/* ... */)
					.put(/* ... */)
					.delete(/* ... */),
			)

			// GET routes are public (or add guard if needed)
			.get(/* ... */)
	);
}
```

---

## Type Safety

Eden Treaty provides full type inference:

```typescript
// User's app
import { treaty } from '@elysiajs/eden';
import type { App } from '@glaze/core';

const glaze = treaty<App>('http://localhost:3000');

// Fully typed!
const { data: posts } = await glaze.api.posts.get();
//    ^? Post[]

const { data: post } = await glaze.api.posts({ id: '123' }).get();
//    ^? Post

await glaze.api.posts.post({
	title: 'Hello', // ✅ Typed
	invalid: 'field', // ❌ Type error!
});
```

---

## Input Validation

Elysia provides runtime validation:

```typescript
.post(`/${tableName}`, async ({ body }) => {
  // body is validated against schema
}, {
  body: t.Object({
    title: t.String({ minLength: 1, maxLength: 200 }),
    content: t.String(),
    status: t.Optional(t.Union([
      t.Literal('draft'),
      t.Literal('published')
    ]))
  })
})
```

**Future:** Auto-generate validation schemas from Drizzle schema

---

## Query Features (Future)

V1.1 will add:

### Filtering

```
GET /api/posts?status=published
GET /api/posts?author=uuid123
```

### Sorting

```
GET /api/posts?sort=createdAt:desc
GET /api/posts?sort=title:asc
```

### Pagination

```
GET /api/posts?page=2&limit=20
```

### Field Selection

```
GET /api/posts?fields=id,title
```

### Relationships

```
GET /api/posts?include=author,comments
```

---

## Customization

### Override Generated Routes

```typescript
import { createGlaze } from '@glaze/core';
import * as collections from './collections';

const glaze = createGlaze({
	collections,
	// ... other config
});

// Add custom route
glaze.get('/api/posts/featured', async () => {
	return db.query.posts.findMany({
		where: eq(posts.featured, true),
	});
});

// Override generated route
glaze.get('/api/posts', async () => {
	// Custom logic
	return db.query.posts.findMany({
		orderBy: desc(posts.createdAt),
		limit: 10,
	});
});
```

---

## Performance

### Database Queries

Generated routes use Drizzle's query builder:

- Prepared statements (SQL injection safe)
- Connection pooling
- Efficient SQL generation

### Response Caching (Future)

```typescript
glaze.get(
	'/api/posts',
	async () => {
		return db.query.posts.findMany();
	},
	{
		cache: {
			ttl: 60, // Cache for 60 seconds
			key: 'posts:all',
		},
	},
);
```

---

## Next Steps

- [Convergence Engine](./05-convergence.md)
- [Security](./06-security.md)
