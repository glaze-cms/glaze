# Glaze Blog Example

A simple blog example demonstrating Glaze CMS with auto-generated Content API.

## What This Example Shows

- ✅ **Simple setup** - Minimal configuration to get started
- ✅ **Type-safe schema** - Drizzle ORM schema definition
- ✅ **Auto-generated API** - Health and ready endpoints (CRUD coming in Phase 2)
- ✅ **Config validation** - Automatic validation with helpful errors

## Quick Start

### 1. Install Dependencies

From the monorepo root:

```bash
bun install
```

### 2. Create PostgreSQL Database

```bash
createdb glaze_blog
```

### 3. Configure Environment

```bash
cd examples/blog
cp .env.example .env
```

Edit `.env` with your database credentials:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/glaze_blog
PORT=4000
```

### 4. Start Development Server

```bash
bun dev
```

You should see:

```
INFO (glaze): 🍰 Glaze CMS v0.0.1 starting...
INFO (glaze): Connecting to PostgreSQL...
INFO (glaze): 🍰 Glaze CMS v0.0.1 ready
INFO (glaze):    API prefix: /api
```

### 5. Test the Endpoints

```bash
# Health check
curl http://localhost:4000/api/health

# Response:
# {"status":"ok","version":"0.0.1","timestamp":"2024-12-10T..."}

# Ready check (verifies database connection)
curl http://localhost:4000/api/ready

# Response:
# {"status":"ready","database":"connected","timestamp":"2024-12-10T..."}
```

## Project Structure

```
examples/blog/
├── .env.example          # Environment template
├── .env                  # Your local environment (git-ignored)
├── package.json          # Dependencies and scripts
├── src/
│   ├── index.ts          # Entry point
│   └── schema.ts         # Drizzle schema (posts table)
└── README.md            # This file
```

## Code Walkthrough

### Entry Point (`src/index.ts`)

```typescript
import { glaze } from '@glaze/core';
import * as schema from './schema';

const blog = glaze({
	database: process.env.DATABASE_URL!,
	schema,
});

blog.start(4000);
```

That's it! Glaze handles:

- Config validation
- Database connection
- API setup
- Server startup

### Schema Definition (`src/schema.ts`)

```typescript
import { pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const posts = pgTable('posts', {
	id: serial('id').primaryKey(),
	title: varchar('title', { length: 255 }).notNull(),
	slug: varchar('slug', { length: 255 }).notNull().unique(),
	content: text('content'),
	status: varchar('status', { length: 20 }).default('draft'),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
});
```

A simple blog posts table. In **Phase 2**, Glaze will auto-generate CRUD endpoints for this table.

## Configuration Options

You can customize Glaze behavior:

```typescript
import { glaze } from '@glaze/core';
import * as schema from './schema';

const blog = glaze({
	database: process.env.DATABASE_URL!,
	schema,

	// Optional: Custom API prefix
	prefix: '/api/v1',

	// Optional: Custom port
	port: 3000,

	// Optional: Development settings
	development: {
		strategy: 'migrate', // or 'push' for fast prototyping
		skipMigrationChecks: false,
	},

	// Optional: Logger configuration
	logger: {
		level: 'debug',
	},
});

blog.start(); // Uses config.port or 4000
```

## Using `glazeConfig()` Helper

For better autocomplete and validation:

```typescript
// glaze.config.ts
import { glazeConfig } from '@glaze/core';
import * as schema from './schema';

export default glazeConfig({
	database: process.env.DATABASE_URL!,
	schema,
	port: 4000,
});

// src/index.ts
import { glaze } from '@glaze/core';
import config from './glaze.config';

glaze(config).start();
```

## What's Coming Next

**Phase 2: Auto-Generated Content API**

Once implemented, this schema will automatically get:

```
GET    /api/posts           - List all posts
POST   /api/posts           - Create new post
GET    /api/posts/:id       - Get single post
PUT    /api/posts/:id       - Update post
DELETE /api/posts/:id       - Delete post
```

With automatic:

- ✅ Request/response validation
- ✅ Type safety
- ✅ OpenAPI documentation
- ✅ Pagination support

**Phase 3: Database Migrations**

```bash
# Generate migration from schema changes
bun db:generate

# Apply migrations
bun db:migrate
```

**Phase 4: Convergence Engine**

Automatic detection and resolution of schema drift in development.

## Customizing Routes

Add custom routes alongside auto-generated ones:

```typescript
import { Elysia } from 'elysia';
import { glaze } from '@glaze/core';
import * as schema from './schema';

const customRoutes = new Elysia()
	.get('/custom', () => 'Hello from custom route!')
	.post('/webhooks/stripe', handleStripeWebhook);

const blog = glaze({
	database: process.env.DATABASE_URL!,
	schema,
	routes: customRoutes,
});

blog.start(4000);
```

Custom routes are merged after auto-generated ones, so you can override specific endpoints.

## Troubleshooting

### "Database connection failed"

Make sure PostgreSQL is running:

```bash
psql -d glaze_blog -c "SELECT 1"
```

If the database doesn't exist:

```bash
createdb glaze_blog
```

### "Missing required field: database"

Check your `.env` file has `DATABASE_URL` set:

```bash
cat .env | grep DATABASE_URL
```

### "Invalid database URL"

Make sure the URL format is correct:

```
✅ postgresql://postgres:postgres@localhost:5432/glaze_blog
❌ postgres:localhost:5432/glaze_blog
```

### Port already in use

Change the port in `src/index.ts`:

```typescript
blog.start(4001); // Use different port
```

## Learn More

- [Glaze Documentation](../../README.md)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Elysia](https://elysiajs.com/)
- [Bun](https://bun.sh/)

## Next Steps

1. **Explore the schema** - Add more tables in `src/schema.ts`
2. **Add custom routes** - Create your own endpoints
3. **Wait for Phase 2** - Auto-generated CRUD is coming soon!

---

**Status:** ✅ Phase 1 Complete (Config System)  
**Coming Soon:** Phase 2 (Content API), Phase 3 (Migrations), Phase 4 (Convergence)
