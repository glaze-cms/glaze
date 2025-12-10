# 🍰 Glaze CMS

> A Bun-native content management system built for performance

**Status:** 🚧 Active Development - Phase 1 Complete

---

## What is Glaze?

Glaze is a modern CMS that runs **exclusively on Bun** — leveraging native APIs for maximum performance at minimal cost.

This isn't a Node.js CMS ported to Bun. It's built from the ground up to take full advantage of everything Bun offers.

### For Developers and Editors Alike

Most CMSs force a tradeoff: developer control or editor experience. Glaze refuses to choose.

- **Developers** get full schema control in code, type safety, and extensibility
- **Editors** get a clean, intuitive admin UI that just works
- **Both** benefit from a system that stays in sync and never breaks silently

### Philosophy: Standing on Giants

We don't reinvent wheels. Glaze composes best-in-class libraries into a cohesive CMS:

- **Bun** for native runtime performance
- **Drizzle** for type-safe schema management
- **Elysia** for Bun-native API routing
- **Better-Auth** for authentication (coming soon)
- **TanStack Start** for SSR admin UI (coming soon)

---

## Quick Start

### Installation

```bash
# Create a new Glaze project (coming soon)
bunx create-glaze my-blog

# Or add to existing project
bun add @glaze/core drizzle-orm
```

### Basic Usage

```typescript
// src/index.ts
import { glaze } from '@glaze/core';
import * as schema from './schema';

const app = glaze({
	database: process.env.DATABASE_URL!,
	schema,
});

app.start(4000);
```

That's it! Glaze handles configuration, validation, and server startup.

### Define Your Schema

```typescript
// src/schema.ts
import { pgTable, serial, text, varchar, timestamp } from 'drizzle-orm/pg-core';

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

### Auto-Generated API (Phase 2)

Once Phase 2 is complete, your schema automatically gets CRUD endpoints:

```bash
GET    /api/posts           # List all posts
POST   /api/posts           # Create new post
GET    /api/posts/:id       # Get single post
PUT    /api/posts/:id       # Update post
DELETE /api/posts/:id       # Delete post
```

With automatic:

- ✅ Request/response validation
- ✅ Type safety
- ✅ OpenAPI documentation
- ✅ Pagination support

---

## Why Glaze?

### 🚀 Faster Development

- **Instant hot reload** with Bun's native watch mode
- **Changes reflect immediately** — no slow rebuild cycles
- **Schema drift detection** catches issues before they break production

### ⚡ Better Performance

- **3x faster startup** than Node.js-based alternatives
- **Lower memory footprint** — runs smoothly on 512MB RAM
- **Native database bindings** eliminate middleware overhead

### 💰 Lower Hosting Costs

- **Smaller servers** — what needs 2GB elsewhere runs on 512MB
- **Fewer resources** — less memory, less CPU, lower bills
- **Single deployment** — no separate admin instance needed

---

## Configuration

### Simple Configuration

```typescript
import { glaze } from '@glaze/core';
import * as schema from './schema';

glaze({
	database: process.env.DATABASE_URL!,
	schema,
}).start(4000);
```

### Advanced Configuration

```typescript
import { glazeConfig } from '@glaze/core';
import * as schema from './schema';

export default glazeConfig({
	database: process.env.DATABASE_URL!,
	schema,

	// API configuration
	prefix: '/api/v1',
	port: 4000,

	// Development settings
	development: {
		strategy: 'migrate', // or 'push' for fast prototyping
		skipMigrationChecks: false,
	},

	// Migration settings
	migrations: {
		folder: './migrations',
		table: '__drizzle_migrations',
		schema: 'drizzle', // Separate schema for migrations
	},

	// Content API
	contentAPI: {
		enabled: true,
		exclude: [], // Tables to exclude from auto-generation
	},

	// Logger
	logger: {
		level: 'info',
	},
});
```

### Database Schemas

Glaze uses three PostgreSQL schemas for clean separation:

```
├── public schema          ← Your application data
│   ├── posts
│   ├── users
│   └── comments
│
├── drizzle schema         ← Migration history
│   └── __drizzle_migrations
│
└── glaze schema           ← CMS infrastructure (Phase 4)
    ├── settings
    ├── entities
    └── user_preferences
```

---

## Custom Routes

Add custom routes alongside auto-generated ones:

```typescript
import { Elysia } from 'elysia';
import { glaze } from '@glaze/core';
import * as schema from './schema';

const customRoutes = new Elysia()
	.get('/health-check', () => ({ status: 'healthy' }))
	.post('/webhooks/stripe', handleStripeWebhook)
	.get('/posts/published', getPublishedPosts);

const app = glaze({
	database: process.env.DATABASE_URL!,
	schema,
	routes: customRoutes,
});

app.start(4000);
```

Custom routes are merged after auto-generated routes, so you can override specific endpoints by method/path.

---

## The Convergence Engine (Phase 4)

Schema drift is inevitable. Developers edit code, admins tweak settings, databases get modified directly. Most CMSs break silently when this happens. Glaze detects it.

**Convergence** is a bidirectional sync engine that keeps your code, database, and admin UI in harmony:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Schema    │◄───►│  Database   │◄───►│  Admin UI   │
│   Files     │     │             │     │   Editor    │
└─────────────┘     └─────────────┘     └─────────────┘
        ▲                                      │
        └──────────────────────────────────────┘
                    Convergence Engine
```

**On startup in development**, Convergence detects and helps you resolve drift:

```
⚠️  Schema drift detected!

Your database schema does not match your schema files.

  1) Generate migration from DB changes (accept DB state)
  2) Generate migration from code changes (revert DB to code)
  3) Show detailed diff

You must resolve this before continuing.

Your choice [1-3]: _
```

---

## Roadmap

### ✅ Phase 1: Config System (Complete)

- [x] Config validation
- [x] Type-safe configuration
- [x] Database connection
- [x] Health/ready endpoints
- [x] Logger integration

### 🚧 Phase 2: Content API (In Progress)

- [ ] Auto-generated CRUD endpoints
- [ ] Request/response validation
- [ ] Pagination support
- [ ] OpenAPI documentation

### 📋 Phase 3: Migrations

- [ ] Schema migration workflow
- [ ] Push vs migrate strategies
- [ ] Migration history
- [ ] Auto-run on startup

### 🔮 Phase 4: Convergence Engine

- [ ] Schema drift detection
- [ ] Interactive resolution
- [ ] Bidirectional sync
- [ ] CLI integration

### 🎨 Phase 5: Admin UI

- [ ] TanStack Start admin
- [ ] Content management
- [ ] Schema editor (dev only)
- [ ] Media library

---

## Technology Stack

| Layer      | Technology           | Why?                                        |
| ---------- | -------------------- | ------------------------------------------- |
| Runtime    | Bun                  | Native TypeScript, fast startup, low memory |
| Database   | PostgreSQL + Drizzle | Type-safe ORM, native bindings              |
| Backend    | Elysia               | Built for Bun, type-safe, fastest framework |
| Admin UI   | TanStack Start       | SSR with typed server functions             |
| Auth       | Better-Auth          | Framework-agnostic, battle-tested           |
| Validation | drizzle-typebox      | Schema → validation → OpenAPI               |

---

## Requirements

- **Bun v1.0+** (required — Glaze does not run on Node.js)
- PostgreSQL 15+

---

## Development

```bash
# Clone repository
git clone git@github.com:glaze-cms/glaze.git
cd glaze

# Install dependencies
bun install

# Run blog example
cd examples/blog
bun dev
```

---

## Project Structure

```
glaze/
├── packages/
│   ├── core/           # Core Glaze engine
│   ├── shared/         # Shared types and utilities
│   ├── logger/         # Pino-based logger
│   ├── convergence/    # Schema drift detection (Phase 4)
│   └── admin/          # Admin UI (Phase 5)
│
├── examples/
│   └── blog/           # Simple blog example
│
└── docs/               # Documentation
```

---

## Contributing

Glaze is in active development. We're not accepting external contributions yet, but feedback and issue reports are welcome!

---

## License

MIT

---

_Bun-native. Standing on giants. Shipping fast._
