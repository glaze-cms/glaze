# 🌊 Glaze CMS - Complete Technical Summary

> **A next-generation CMS built on Bun, Drizzle, Elysia, and TanStack Start**
>
> _Standing on the shoulders of giants_

---

## 🎯 Core Value Proposition

**Glaze = Strapi's UX + Payload's Integration + Drizzle's Type Safety + Bun's Performance**

At a fraction of the operational cost.

### Key Differentiators

1. **Schema ↔ UI Cycle**: Schema editor in development, content management in production
2. **Convergence Engine**: Bidirectional sync between code, database, and admin UI (dev-only)
3. **Type-Safe Everything**: End-to-end type safety from database to UI
4. **Cost Efficient**: Runs on smaller instances than Strapi due to Bun's efficiency
5. **Modern Stack**: Built with cutting-edge tools that work together seamlessly
6. **Standing on Giants**: Leverages best-in-class libraries (Better-Auth, Drizzle, etc.)

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│         TanStack Start Admin UI (Port 3000)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐      │
│  │   Content    │  │   Schema     │  │  Convergence  │      │
│  │ Management   │  │   Editor     │  │      UI       │      │
│  │  (all envs)  │  │  (dev only)  │  │  (dev only)   │      │
│  └──────────────┘  └──────────────┘  └───────────────┘      │
│         SSR + Server Functions + Client Components          │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST API + Server Functions
                       ▼
┌─────────────────────────────────────────────────────────────┐
│           Elysia Backend (Port 4000)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐      │
│  │  Content API │  │Custom Routes │  │   Plugins     │      │
│  │     REST     │  │   Webhooks   │  │    System     │      │
│  └──────────────┘  └──────────────┘  └───────────────┘      │
│         Extensible Backend (like Koa for Strapi)            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Convergence Engine (Dev Only)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐      │
│  │    Schema    │  │   Drizzle    │  │   ts-morph    │      │
│  │ Introspection│  │  Kit CLI     │  │  Code Writer  │      │
│  └──────────────┘  └──────────────┘  └───────────────┘      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Drizzle ORM + PostgreSQL                       │
│              Schema Files = Source of Truth                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔗 Deployment Modes

Glaze supports two deployment modes, giving developers flexibility based on their needs:

### Integrated Mode (Single Process)

Run Glaze inside your TanStack Start app. Elysia mounts as a route handler:

```
┌─────────────────────────────────────────┐
│          TanStack Start App             │
│  ┌─────────────┐  ┌─────────────────┐   │
│  │  Your App   │  │   Glaze CMS     │   │
│  │   Routes    │  │  (Admin + API)  │   │
│  └─────────────┘  └─────────────────┘   │
│            Single Bun Process           │
└─────────────────────────────────────────┘
```

```typescript
// src/routes/api.glaze.$.ts
import { createGlazeServer } from '@glaze/core';
import { createFileRoute } from '@tanstack/react-router';

const glaze = createGlazeServer({
	schema: './src/schema.ts',
	database: process.env.DATABASE_URL,
});

const handle = ({ request }: { request: Request }) => glaze.fetch(request);

export const Route = createFileRoute('/api/glaze/$')({
	server: {
		handlers: {
			GET: handle,
			POST: handle,
			PUT: handle,
			DELETE: handle,
		},
	},
});
```

**Benefits**:

- Single deployment (one process)
- Shared database connection
- Lower latency between frontend and CMS
- Eden Treaty for end-to-end type safety (no codegen)

**Best for**: Most projects, simpler ops, smaller teams

### Separate Mode (Two Processes)

Run Glaze as a standalone server:

```
┌─────────────────────┐    ┌─────────────────────┐
│  TanStack Start App │    │     Glaze CMS       │
│    (Port 3000)      │───▶│    (Port 4000)      │
│                     │    │   Admin + API       │
└─────────────────────┘    └─────────────────────┘
```

```typescript
// server.ts
import { createGlazeServer } from '@glaze/core';

const glaze = createGlazeServer({
	schema: './src/schema.ts',
	database: process.env.DATABASE_URL,
});

glaze.listen(4000);
```

**Benefits**:

- Independent scaling
- CMS can run on different infrastructure
- Multiple frontends can share one CMS instance
- Clear separation of concerns

**Best for**: Larger teams, microservices, multiple sites sharing one CMS

### Eden Treaty Integration

Both modes support [Eden Treaty](https://elysiajs.com/eden/overview.html) for end-to-end type safety, similar to tRPC but without code generation:

```typescript
// src/routes/api.glaze.$.ts
import { createGlazeServer } from '@glaze/core';
import { treaty } from '@elysiajs/eden';
import { createFileRoute } from '@tanstack/react-router';
import { createIsomorphicFn } from '@tanstack/react-start';

const glaze = createGlazeServer({
	schema: './src/schema.ts',
	database: process.env.DATABASE_URL,
});

const handle = ({ request }: { request: Request }) => glaze.fetch(request);

export const Route = createFileRoute('/api/glaze/$')({
	server: {
		handlers: {
			GET: handle,
			POST: handle,
			PUT: handle,
			DELETE: handle,
		},
	},
});

// Type-safe client - works on both server and client
export const api = createIsomorphicFn()
	.server(() => treaty(glaze).api)
	.client(() => treaty<typeof glaze>('localhost:3000').api.glaze);
```

Then in your components:

```typescript
// src/routes/index.tsx
import { createFileRoute } from '@tanstack/react-router'
import { api } from './api.glaze.$'

export const Route = createFileRoute('/')({
  component: App,
  loader: () => api().posts.get().then((res) => res.data)
})

function App() {
  const posts = Route.useLoaderData() // Fully typed!
  return <PostList posts={posts} />
}
```

---

## 🛠️ Technology Stack

### Core Technologies (Locked)

| Layer                 | Technology           | Why?                                                          |
| --------------------- | -------------------- | ------------------------------------------------------------- |
| **Runtime**           | Bun                  | 3x faster than Node.js, lower memory usage, native TypeScript |
| **Backend Framework** | Elysia               | Fast, type-safe, extensible (like Koa but modern)             |
| **Admin UI**          | TanStack Start       | SSR React with server functions, framework-agnostic           |
| **ORM**               | Drizzle              | Schema-first, migrations, type-safe, lightweight              |
| **Database**          | PostgreSQL (primary) | Full SQL power, JSONB support, production-ready               |
| **Auth**              | Better-Auth          | Framework-agnostic, OAuth, sessions, TypeScript-first         |
| **API**               | REST (GraphQL later) | Simple, well-understood, sufficient for V1                    |

### Philosophy: Standing on Giants

Glaze doesn't reinvent the wheel. Instead, it integrates best-in-class tools:

- **Better-Auth** for authentication (not custom auth)
- **Drizzle** for database (not custom ORM)
- **Elysia** for API (not custom framework)
- **TanStack** for UI (not custom React framework)

This approach means:

- Faster development
- Fewer bugs (battle-tested libraries)
- Easier hiring (developers know these tools)
- Community support for each layer

### Why This Stack?

**Cost Efficiency**:

- Bun's performance → smaller server instances
- Drizzle's efficiency → less database overhead
- Single deployment → no separate admin hosting

**Type Safety**:

- Drizzle schemas → TypeScript types
- TanStack server functions → typed client/server communication
- Elysia → typed routes and handlers
- End-to-end safety from DB to UI

**Developer Experience**:

- Fast hot reload (Bun)
- Excellent TypeScript support
- Modern tooling
- Clear separation of concerns

---

## 🔄 The Schema ↔ UI Cycle

### Core Concept

**Schema files are the single source of truth.** Schema modifications happen in development only, following the same pattern as Strapi:

```
┌─────────────────────────────────────────────────────────────┐
│                    DEVELOPMENT MODE                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐         ┌─────────────┐                    │
│  │   Schema    │         │  Developer  │                    │
│  │   Editor    │         │ Direct Edit │                    │
│  │    (UI)     │         │ (schema.ts) │                    │
│  └──────┬──────┘         └──────┬──────┘                    │
│         │                       │                            │
│         └───────────┬───────────┘                            │
│                     ▼                                        │
│         ┌───────────────────────┐                            │
│         │   Update Schema Files │                            │
│         └───────────┬───────────┘                            │
│                     ▼                                        │
│         ┌───────────────────────┐                            │
│         │  drizzle-kit generate │                            │
│         └───────────┬───────────┘                            │
│                     ▼                                        │
│         ┌───────────────────────┐                            │
│         │    Apply Migration    │                            │
│         └───────────┬───────────┘                            │
│                     ▼                                        │
│         ┌───────────────────────┐                            │
│         │   Commit to Git       │                            │
│         └───────────────────────┘                            │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ Deploy
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   PRODUCTION MODE                            │
├─────────────────────────────────────────────────────────────┤
│  • Schema editor: DISABLED                                   │
│  • Content management: ENABLED                               │
│  • Convergence: DISABLED (drift = deployment issue)          │
│  • Run migrations in CI before deploy                        │
└─────────────────────────────────────────────────────────────┘
```

### Why Dev-Only Schema Editing?

This matches how Strapi works and avoids complexity:

- No git sync from production needed
- No multi-instance conflicts
- Clear separation: dev = schema changes, prod = content changes
- Convergence stays focused on detecting accidental drift

---

## 🌊 Convergence Engine

**Codename**: _Convergence_  
**Tagline**: _"All paths lead to consistency"_

### What It Is

A **bidirectional sync engine** for schema management in development. It handles three directions:

1. **Code ↔ Database**: Detect and resolve schema drift
2. **Code → UI**: Display schema in admin editor (runtime introspection)
3. **UI → Code**: Write schema changes back to files (ts-morph)

### What It Is NOT

- Not a safety net for reckless DB modifications
- Not a production feature
- Not a guarantee against data loss

### Philosophy

> "If you touch the DB directly, you're operating outside the guardrails. We'll help you detect changes, but you own the consequences."

Convergence is for advanced users who understand the implications. If you reject database changes and lose data, that's on you.

### The Three Sync Directions

#### Direction 1: Code ↔ Database (Drift Detection)

**Tools**: drizzle-kit CLI (`check`, `pull`, `push`, `generate`, `migrate`)

On `bun dev` startup, detect schema drift:

```bash
$ bun dev

🌊 Starting Glaze CMS (development)...
🔍 Checking schema consistency...

⚠️  Schema drift detected!

Your database schema does not match your schema files.
This usually happens when:
  • Database was modified directly (ALTER TABLE)
  • Working on a different branch
  • Pulling changes from another developer

What would you like to do?

  1) Accept database schema (update schema files to match DB)
  2) Reject database changes (⚠️ may cause data loss)
  3) Show differences
  4) Skip for now (app may not work correctly)

Choice: _
```

**Workflow**:

| Step               | Command                | Purpose                    |
| ------------------ | ---------------------- | -------------------------- |
| Detect drift       | `drizzle-kit check`    | Compare code vs DB         |
| Pull DB schema     | `drizzle-kit pull`     | Generate schema.ts from DB |
| Push to DB         | `drizzle-kit push`     | Apply code changes to DB   |
| Generate migration | `drizzle-kit generate` | Create migration files     |
| Apply migration    | `drizzle-kit migrate`  | Run pending migrations     |

#### Direction 2: Code → UI (Schema Introspection)

**Tools**: Drizzle's runtime `getTableConfig()` API

The admin UI needs to display the schema for editing. Instead of parsing TypeScript, we use Drizzle's built-in introspection:

```typescript
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from './schema';

// Import user's schema and extract metadata at runtime
const postsConfig = getTableConfig(schema.posts);

// Returns:
{
  name: 'posts',
  schema: undefined,  // or 'glaze' for system tables
  columns: [
    {
      name: 'id',
      columnType: 'PgSerial',
      dataType: 'number',
      notNull: true,
      hasDefault: true,
      primary: true,
      isUnique: false,
    },
    {
      name: 'title',
      columnType: 'PgVarchar',
      dataType: 'string',
      notNull: true,
      hasDefault: false,
      length: 255,  // varchar length
    },
    // ... more columns
  ],
  indexes: [...],
  foreignKeys: [...],
  primaryKeys: [...],
}
```

**Key insight**: This is generated **on-the-fly** when the admin UI requests it. No caching, no extra files. The schema files are the source of truth.

**What's extracted**:

- Table name and PostgreSQL schema
- All columns with types, constraints, defaults
- Relations (via Drizzle's `relations()` API)
- Indexes and foreign keys
- Enum values (for columns using `pgEnum`)

#### Direction 3: UI → Code (Schema Writing)

**Tools**: ts-morph (TypeScript AST manipulation)

When a user adds/edits a field in the admin schema editor, we need to surgically update the `schema.ts` file without destroying:

- Developer comments
- Custom formatting
- Other tables in the file
- Import statements

ts-morph allows AST-level edits:

```typescript
import { Project } from 'ts-morph';

const project = new Project();
const sourceFile = project.addSourceFileAtPath('src/schema.ts');

// Find the posts table and add a new column
const postsTable = sourceFile.getVariableDeclaration('posts');
// ... manipulate AST to add column
// ... preserve formatting and comments

sourceFile.save();
```

**Why ts-morph over alternatives**:

- Preserves comments and formatting
- Handles complex TypeScript (generics, method chains)
- Battle-tested for codemods
- ~2MB size is acceptable for dev-only tooling

### V1 Scope

**Included**:

- Tables (`pgTable`)
- All standard column types
- Relations (`relations()`)
- Enums (`pgEnum`)
- Indexes and constraints

**Deferred to V2**:

- Custom types (`customType()`) - show as "unsupported" in UI
- Views
- Schemas beyond `public` and `glaze`

### CLI Commands

```bash
# Check schema status (dev only)
$ bun glaze convergence:check

# Manual sync trigger (dev only)
$ bun glaze convergence:sync

# View differences (dev only)
$ bun glaze convergence:diff
```

---

## 🗄️ Admin Metadata Storage

Admin-specific configuration is stored separately from content data using a dedicated PostgreSQL schema, keeping user content tables clean.

### Design Goals

1. **Invisible to casual users** — admin UI just works
2. **Inspectable by advanced users** — clear structure, not a junk drawer
3. **Doesn't pollute content tables** — your `posts` table stays clean
4. **Clear separation** — system tables in `glaze` schema, content in `public` schema

### Schema Separation

```
glaze schema (system):
├── settings
├── entities
└── user_preferences

public schema (user content):
├── posts
├── users
└── ... (all user-defined tables)
```

### Three Tables, Three Concerns

| Table                    | Purpose                               | Scope                  |
| ------------------------ | ------------------------------------- | ---------------------- |
| `glaze.settings`         | Global admin settings                 | Singleton (one row)    |
| `glaze.entities`         | Content-type and field display config | Per content-type/field |
| `glaze.user_preferences` | User view preferences                 | Per user, per context  |

### Structure

```typescript
// Global admin settings — single row
export const settings = pgTable(
	'settings',
	{
		id: serial('id').primaryKey(),
		siteName: text('site_name'),
		logo: text('logo'),
		primaryColor: text('primary_color'),
		updatedAt: timestamp('updated_at').defaultNow(),
	},
	(table) => ({
		schema: 'glaze',
	}),
);

// Content-type and field configuration
export const entities = pgTable(
	'entities',
	{
		id: serial('id').primaryKey(),
		key: text('key').notNull().unique(), // 'posts', 'posts.title'
		value: jsonb('value').notNull(),
		updatedAt: timestamp('updated_at').defaultNow(),
	},
	(table) => ({
		schema: 'glaze',
	}),
);

// Per-user preferences
export const userPreferences = pgTable(
	'user_preferences',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		context: text('context').notNull(), // 'list.posts', 'editor.posts'
		prefs: jsonb('prefs').notNull(),
		updatedAt: timestamp('updated_at').defaultNow(),
	},
	(table) => ({
		unique: unique().on(table.userId, table.context),
		schema: 'glaze',
	}),
);
```

### Examples

**`glaze.settings`** (one row):
| siteName | logo | primaryColor |
|----------|------|------------|
| "My CMS" | "/uploads/logo.png" | "#3b82f6" |

**`glaze.entities`**:
| key | value |
|-----|-------|
| `posts` | `{ displayName: "Blog Posts", icon: "newspaper" }` |
| `posts.title` | `{ helpText: "Keep under 60 chars", width: "full" }` |
| `users` | `{ displayName: "Team Members", icon: "users" }` |

**`glaze.user_preferences`**:
| userId | context | prefs |
|--------|---------|-------|
| 1 | `list.posts` | `{ sortBy: "createdAt", sortOrder: "desc", columns: ["title", "status"], pageSize: 25 }` |
| 2 | `list.posts` | `{ sortBy: "title", sortOrder: "asc", pageSize: 10 }` |

### What Users See in Database

```
Schemas:
  public              ← user content tables
  glaze               ← CMS system tables

public.posts          ← their content
public.users          ← their content

glaze.settings        ← site name, logo (1 row)
glaze.entities        ← content-type/field display options
glaze.user_preferences ← each user's view preferences
```

---

## 🎨 Admin UI (TanStack Start)

### Why TanStack Start?

- **SSR + Server Functions**: Security benefits without SPA token exposure
- **Type-Safe**: Server functions fully typed
- **Framework-Agnostic**: Works with Elysia backend
- **Modern DX**: Better than Next.js complexity, more structured than Vite SPA
- **Future-proof**: Actively developed, growing ecosystem

### Key Features

**Content Management** (all environments):

- Auto-generated forms from Drizzle schemas
- Rich text editor
- Media library
- Relationship management
- Bulk operations

**Schema Editor** (dev only):

- Visual form builder
- Add/edit fields through UI
- Configure validations
- Set default values
- Manage relationships

**Convergence UI** (dev only):

- Schema health indicator
- Diff viewer
- One-click sync
- Migration history

**User Management**:

- Powered by Better-Auth
- Role-based access control
- Permissions system
- API key management

---

## 🔌 Backend API (Elysia)

### Why Elysia?

- **Performance**: One of the fastest frameworks
- **Type Safety**: End-to-end typed routes
- **Plugin System**: Extensible architecture
- **Bun Native**: Designed for Bun runtime

### Extensibility Model

Developers can extend Glaze with custom routes:

```typescript
// glaze.config.ts
export default {
	plugins: [customAnalytics(), stripeWebhooks()],

	extend: (app: Elysia) => {
		app.group('/api/custom', (app) =>
			app.get('/analytics', getAnalytics).post('/webhooks', handleWebhook),
		);
	},
};
```

### Built-in APIs

**Content API** (auto-generated from schema):

```typescript
GET    /api/posts
POST   /api/posts
GET    /api/posts/:id
PUT    /api/posts/:id
DELETE /api/posts/:id

// With filters, pagination, sorting
GET /api/posts?filter[status]=published&sort=-createdAt&limit=10
```

**Admin API**:

```typescript
POST   /api/admin/schema/field      // dev only
DELETE /api/admin/schema/field/:id  // dev only
GET    /api/admin/convergence/status // dev only
POST   /api/admin/convergence/sync   // dev only
```

**Auth API** (via Better-Auth):

```typescript
POST / api / auth / login;
POST / api / auth / logout;
POST / api / auth / register;
GET / api / auth / me;
// + OAuth flows, magic links, etc.
```

---

## 📊 Competitive Comparison

| Feature            | Strapi                    | Payload                     | Glaze                         |
| ------------------ | ------------------------- | --------------------------- | ----------------------------- |
| **Runtime**        | Node.js                   | Node.js                     | Bun (3x faster)               |
| **ORM**            | Bookshelf/Knex            | Drizzle                     | Drizzle (type-safe)           |
| **Schema Drift**   | ❌ Breaks silently        | ⚠️ Manual fix               | ✅ Detection + recovery tools |
| **Type Safety**    | ⚠️ Partial                | ✅ Good                     | ✅ End-to-end                 |
| **Admin UI**       | React SPA                 | Next.js                     | SSR (TanStack Start)          |
| **Auth**           | Custom                    | Custom                      | Better-Auth (battle-tested)   |
| **Extensibility**  | ✅ Plugin system          | ✅ Hooks system             | ✅ Elysia plugins             |
| **Cost**           | High (memory hungry)      | Medium                      | Low (Bun efficiency)          |
| **DB Support**     | PostgreSQL, MySQL, SQLite | PostgreSQL, MongoDB, SQLite | PostgreSQL (MySQL later)      |
| **Schema editing** | Dev only                  | Code only                   | Dev only (UI + code)          |

### Key Advantages

**vs Strapi**:

- Lower hosting costs (Bun efficiency)
- Better type safety (Drizzle vs Bookshelf)
- Schema drift detection (Convergence)
- Modern stack (Bun, Elysia, TanStack)

**vs Payload**:

- Simpler auth (Better-Auth vs custom)
- Schema editor UI (Payload is code-only)
- Not tied to Next.js
- Cleaner separation of concerns

---

## 🚀 Deployment & Hosting

### Recommended Platforms

**Long-Running Servers** (optimal):

- **Fly.io**: Native Bun support, persistent storage
- **Railway**: Simple deployment, built-in PostgreSQL
- **VPS** (DigitalOcean, Hetzner): Full control, cheapest option

**Development Flow**:

```
Local dev → Commit schema changes → CI runs migrations → Deploy
```

### Why Not Serverless?

**Limitations for Glaze**:

- No persistent database connections
- Cold starts hurt admin UX
- Migration operations need stable environment

**Serverless works for**:

- Read-only API endpoints (can be cached/proxied)
- Static frontend deployment
- But NOT for core CMS operations

### Deployment Size

**Minimal Setup**:

- 512MB RAM (vs 1-2GB for Strapi)
- 1 vCPU
- ~$5-10/month VPS

**Production Setup**:

- 1-2GB RAM
- 2 vCPU
- ~$20-30/month

---

## 📁 Project Structure

```
glaze/
├── packages/
│   ├── core/                 # Core Glaze engine
│   │   ├── convergence/      # Convergence engine
│   │   ├── schema/           # Schema management
│   │   └── migrations/       # Migration utilities
│   │
│   ├── backend/              # Elysia backend
│   │   ├── api/              # Content API
│   │   ├── plugins/          # Plugin system
│   │   └── config/           # Configuration
│   │
│   ├── admin/                # TanStack Start admin
│   │   ├── app/              # Admin routes
│   │   ├── components/       # UI components
│   │   └── server/           # Server functions
│   │
│   └── cli/                  # CLI tools
│       └── commands/         # Convergence commands
│
├── examples/
│   ├── blog/                 # Example blog CMS
│   └── ecommerce/            # Example store CMS
│
└── docs/                     # Documentation
```

---

## 🎯 Development Roadmap

### V1 - Core Features (MVP)

**Convergence Engine**:

- [ ] Drift detection on startup (dev only)
- [ ] Interactive CLI for accept/reject
- [ ] Schema introspection via `getTableConfig()`
- [ ] Code generation via ts-morph
- [ ] Relations support
- [ ] Enum support
- [ ] Migration generation & application
- [ ] Clear warnings for destructive operations

**Admin UI**:

- [ ] Content management (CRUD)
- [ ] Auto-generated forms from schema
- [ ] Media library
- [ ] Schema editor (dev only)
- [ ] Schema health indicator (dev only)

**Backend API**:

- [ ] Auto-generated REST API
- [ ] Basic plugin system
- [ ] Webhook support

**Auth (via Better-Auth)**:

- [ ] Email/password login
- [ ] OAuth providers
- [ ] Session management
- [ ] RBAC layer on top

**Database**:

- [ ] PostgreSQL support
- [ ] `glaze` schema for system tables (`settings`, `entities`, `user_preferences`)
- [ ] Clean content tables in `public` schema (no metadata pollution)

### V2 - Enhanced Features

**Convergence Enhancements**:

- [ ] Custom type support (`customType()`)
- [ ] Line-by-line schema diff viewer
- [ ] Selective field acceptance
- [ ] Migration history viewer
- [ ] AI-assisted migration suggestions

**API**:

- [ ] GraphQL support
- [ ] TypeScript SDK generation

**Advanced Admin**:

- [ ] Content versioning
- [ ] Draft/publish workflow
- [ ] Audit logs

**Database**:

- [ ] MySQL support
- [ ] SQLite for demo mode

### V3 - Enterprise Features

**Collaboration**:

- [ ] Schema change proposals (PR-style)
- [ ] Team approval workflows
- [ ] Comment system

**Performance**:

- [ ] Query optimization
- [ ] Caching layer
- [ ] CDN integration

**i18n**:

- [ ] Multi-language content
- [ ] Localized admin UI

---

## 💡 Key Insights

### What Makes Glaze Different

1. **Standing on giants** — Uses best-in-class libraries, not NIH syndrome
2. **Dev/prod separation** — Schema changes in dev, content in prod (like Strapi)
3. **Convergence as bidirectional sync** — Code ↔ DB ↔ UI all stay in sync
4. **Type safety everywhere** — From database to UI, all typed
5. **Cost efficiency** — Bun + Drizzle = smaller servers

### Design Decisions

**Why dev-only schema editing?**

- Matches Strapi's proven model
- Avoids multi-instance conflicts
- Keeps production stable
- Changes go through git

**Why runtime introspection for Code → UI?**

- Drizzle's `getTableConfig()` gives us everything
- No need to parse TypeScript ourselves
- Always accurate (same code that runs the app)
- Generated on-the-fly, no caching complexity

**Why ts-morph for UI → Code?**

- Preserves comments and formatting
- Surgical edits, not full regeneration
- Handles complex TypeScript patterns
- Battle-tested for codemods

**Why Better-Auth instead of custom auth?**

- Auth is hard and security-critical
- Better-Auth is battle-tested
- Saves months of development
- Follows "standing on giants" philosophy

**Why PostgreSQL first?**

- Full SQL power needed for production apps
- JSONB for metadata storage
- Separate schemas (`glaze` vs `public`) for clean separation
- SQLite can come later as demo mode

---

## 🎬 Getting Started (Future)

```bash
# Create new Glaze project
bunx create-glaze my-cms

# Start development
cd my-cms
bun install
bun dev

# Admin UI: http://localhost:3000
# API: http://localhost:4000

# Check schema status
bun glaze convergence:check

# Run migrations
bun glaze migrate

# Generate types
bun glaze generate:types
```

---

## 📚 Philosophy

> **"Stand on the shoulders of giants"**

Glaze doesn't reinvent authentication, ORMs, or frameworks. It composes the best tools into a cohesive CMS experience.

> **"Detect chaos, don't prevent it"**

Convergence tells you when things drift. It doesn't promise to save you from yourself. Advanced users get visibility, not a safety net.

**Core beliefs**:

- Use the best tools, don't build everything custom
- Schema changes belong in development, not production
- Type safety shouldn't be sacrificed for flexibility
- Modern tools enable better architectures
- Cost efficiency matters

---

## 🌟 Summary

**Glaze CMS** = Next-generation content management built on:

- **Bun** for performance
- **Drizzle** for type-safe schemas
- **Elysia** for extensible backend
- **TanStack Start** for modern admin UI
- **Better-Auth** for authentication
- **Convergence** for bidirectional schema sync

**Target users**: Agencies, startups, developers who want Strapi's UX with better performance, type safety, and lower costs.

**Competitive positioning**: "The CMS that keeps schema in sync" + "Modern stack, smaller servers"

**Status**: Architecture defined, decisions locked, ready for implementation

---

## 📋 Decisions Log

| Decision         | Choice                                   | Rationale                            |
| ---------------- | ---------------------------------------- | ------------------------------------ |
| Runtime          | Bun                                      | Performance, future-proof            |
| Framework        | Elysia                                   | Type-safe, Bun-native                |
| Admin UI         | TanStack Start                           | SSR, modern, growing                 |
| ORM              | Drizzle                                  | Type-safe, lightweight               |
| Database         | PostgreSQL (primary)                     | Production-ready, JSONB, schemas     |
| Auth             | Better-Auth                              | Battle-tested, not NIH               |
| API              | REST first, GraphQL V2                   | Simple wins                          |
| Schema editing   | Dev-only                                 | Matches Strapi, avoids complexity    |
| Metadata storage | `glaze` PostgreSQL schema                | Clean content tables in `public`     |
| Code → UI        | Runtime introspection (`getTableConfig`) | Uses Drizzle's own understanding     |
| UI → Code        | ts-morph                                 | Preserves formatting, surgical edits |
| DB ↔ Code        | drizzle-kit CLI                          | Proven tooling, no reinvention       |
| V1 scope         | Tables, relations, enums                 | Core features first                  |
| Custom types     | V2                                       | Edge case for power users            |
| Deployment modes | Integrated + Separate                    | Flexibility like Payload             |
| Type-safe client | Eden Treaty                              | End-to-end types, no codegen         |

---

_Glaze: Standing on giants, keeping schema in sync, shipping fast._
