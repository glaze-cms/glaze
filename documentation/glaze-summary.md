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
2. **Convergence Engine**: Detection and recovery aid for schema drift (dev-only)
3. **Type-Safe Everything**: End-to-end type safety from database to UI
4. **Cost Efficient**: Runs on smaller instances than Strapi due to Bun's efficiency
5. **Modern Stack**: Built with cutting-edge tools that work together seamlessly
6. **Standing on Giants**: Leverages best-in-class libraries (Better-Auth, Drizzle, etc.)

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│         TanStack Start Admin UI (Port 3000)             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │   Content    │  │   Schema     │  │  Convergence  │  │
│  │ Management   │  │   Editor     │  │      UI       │  │
│  │  (all envs)  │  │  (dev only)  │  │  (dev only)   │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
│         SSR + Server Functions + Client Components      │
└──────────────────────┬──────────────────────────────────┘
                       │ REST API + Server Functions
                       ▼
┌─────────────────────────────────────────────────────────┐
│           Elysia Backend (Port 4000)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Content API │  │Custom Routes │  │   Plugins     │  │
│  │     REST     │  │   Webhooks   │  │    System     │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
│         Extensible Backend (like Koa for Strapi)        │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              Convergence Engine (Dev Only)              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │Drift Detection│  │   Drizzle   │  │      UI       │  │
│  │ (check/pull) │  │  Migrations  │  │   Generator   │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              Drizzle ORM + PostgreSQL                   │
│              Schema Files = Source of Truth             │
└─────────────────────────────────────────────────────────┘
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

A **detection and recovery aid** for schema drift in development. It tells you when something changed and gives you tools to resolve it.

### What It Is NOT

- Not a safety net for reckless DB modifications
- Not a production feature
- Not a guarantee against data loss

### Philosophy

> "If you touch the DB directly, you're operating outside the guardrails. We'll help you detect changes, but you own the consequences."

Convergence is for advanced users who understand the implications. If you reject database changes and lose data, that's on you.

### When It Runs

**Development mode only**, on app startup:

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

### The Convergence Workflow

#### Step 1: Detect Drift

```bash
drizzle-kit check --dialect=postgresql
```

- Exits successfully → No drift
- Exits with error → Drift detected

#### Step 2: Pull Database Schema

```bash
drizzle-kit pull
```

- Generates `drizzle/schema.ts` from current database state
- Doesn't touch existing `src/schema.ts`

#### Step 3: User Decision

**Option 1 - Accept** (safe):

```bash
✅ Accepting database schema...

📄 Copying drizzle/schema.ts → src/schema.ts
📝 Generating migration from new schema...
⚡ Applying migration...
🎨 Regenerating admin UI...

✅ Glaze is ready! Schema in sync.
```

**Option 2 - Reject** (potentially destructive):

```bash
⚠️  WARNING: This may cause data loss!

The following changes will be reverted:
  • DROP COLUMN posts.new_field (contains 142 rows of data)
  • ALTER COLUMN users.email (type change)

Type "I understand" to proceed: _
```

**Option 3 - Show Differences**:

```bash
📊 Comparing schemas:

  Current schema:  src/schema.ts
  Database schema: drizzle/schema.ts (just generated)

Open them in your editor to compare:
  $ code --diff src/schema.ts drizzle/schema.ts

Press Enter to continue...
```

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

Admin-specific configuration is stored separately from content data across three tables, each with a clear purpose.

### Design Goals

1. **Invisible to casual users** — admin UI just works
2. **Inspectable by advanced users** — clear structure, not a junk drawer
3. **Doesn't pollute content tables** — your `posts` table stays clean
4. **Clear separation** — settings vs entities vs user preferences

### Three Tables, Three Concerns

| Table               | Purpose                               | Scope                  |
| ------------------- | ------------------------------------- | ---------------------- |
| `_glaze_settings`   | Global admin settings                 | Singleton (one row)    |
| `_glaze_entities`   | Content-type and field display config | Per content-type/field |
| `_glaze_user_prefs` | User view preferences                 | Per user, per context  |

### Structure

````typescript
// Global admin settings — single row
export const _glazeSettings = pgTable('_glaze_settings', {
  id: serial('id').primaryKey(),
  siteName: text('site_name'),
  logo: text('logo'),
  primaryColor: text('primary_color'),
  updatedAt: timestamp('updated_at').defaultNow()
})

// Content-type and field configuration
export const _glazeEntities = pgTable('_glaze_entities', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),  // 'posts', 'posts.title'
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow()
})

// Per-user preferences
export const _glazeUserPrefs = pgTable('_glaze_user_prefs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  context: text('context').notNull(),   // 'list.posts', 'editor.posts'
  prefs: jsonb('prefs').notNull(),
  updatedAt: timestamp('updated_at').defaultNow()
}, (table) => ({
  unique: unique().on(table.userId, table.context)
}))


### Examples

**`_glaze_settings`** (one row):
| siteName | logo | primaryColor |
|----------|------|--------------|
| "My CMS" | "/uploads/logo.png" | "#3b82f6" |

**`_glaze_entities`**:
| key | value |
|-----|-------|
| `posts` | `{ displayName: "Blog Posts", icon: "newspaper" }` |
| `posts.title` | `{ helpText: "Keep under 60 chars", width: "full" }` |
| `users` | `{ displayName: "Team Members", icon: "users" }` |

**`_glaze_user_prefs`**:
| userId | context | prefs |
|--------|---------|-------|
| 1 | `list.posts` | `{ sortBy: "createdAt", sortOrder: "desc", columns: ["title", "status"], pageSize: 25 }` |
| 2 | `list.posts` | `{ sortBy: "title", sortOrder: "asc", pageSize: 10 }` |

### What Users See in Database

\`\`\`
Tables:
  posts              ← their content
  users              ← their content
  _glaze_settings    ← site name, logo (1 row)
  _glaze_entities    ← content-type/field display options
  _glaze_user_prefs  ← each user's view preferences
\`\`\`
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
````

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
- [ ] Schema file synchronization
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
- [ ] `_glaze_meta` table for admin config
- [ ] Clean content tables (no metadata pollution)

### V2 - Enhanced Features

**Convergence Enhancements**:

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
3. **Convergence as detection** — Helps you see drift, doesn't promise magic
4. **Type safety everywhere** — From database to UI, all typed
5. **Cost efficiency** — Bun + Drizzle = smaller servers

### Design Decisions

**Why dev-only schema editing?**

- Matches Strapi's proven model
- Avoids multi-instance conflicts
- Keeps production stable
- Changes go through git

**Why Convergence as a detection tool (not safety net)?**

- Direct DB access = advanced user territory
- We detect and inform, you decide
- No false promises about data safety
- AI can assist with complex migrations

**Why Better-Auth instead of custom auth?**

- Auth is hard and security-critical
- Better-Auth is battle-tested
- Saves months of development
- Follows "standing on giants" philosophy

**Why PostgreSQL first?**

- Full SQL power needed for production apps
- JSONB for metadata storage
- Your users are building real apps, not prototypes
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
- **Convergence** for schema drift detection

**Target users**: Agencies, startups, developers who want Strapi's UX with better performance, type safety, and lower costs.

**Competitive positioning**: "The CMS that detects schema drift" + "Modern stack, smaller servers"

**Status**: Architecture defined, decisions locked, ready for implementation

---

## 📋 Decisions Log

| Decision         | Choice                         | Rationale                         |
| ---------------- | ------------------------------ | --------------------------------- |
| Runtime          | Bun                            | Performance, future-proof         |
| Framework        | Elysia                         | Type-safe, Bun-native             |
| Admin UI         | TanStack Start                 | SSR, modern, growing              |
| ORM              | Drizzle                        | Type-safe, lightweight            |
| Database         | PostgreSQL (primary)           | Production-ready, JSONB           |
| Auth             | Better-Auth                    | Battle-tested, not NIH            |
| API              | REST first, GraphQL V2         | Simple wins                       |
| Schema editing   | Dev-only                       | Matches Strapi, avoids complexity |
| Convergence      | Detection tool, not safety net | Honest about limitations          |
| Metadata storage | `_glaze_meta` table            | Clean content tables              |

---

_Glaze: Standing on giants, detecting chaos, shipping fast._
