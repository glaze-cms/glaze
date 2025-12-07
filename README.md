# 🍰 Glaze CMS

> A Bun-native content management system built for performance

**Status:** 🚧 Early Development

---

## What is Glaze?

Glaze is a modern CMS that runs **exclusively on Bun** — leveraging native APIs like `Bun.sql`, `Bun.file`, and the Bun runtime for maximum performance at minimal cost.

This isn't a Node.js CMS ported to Bun. It's built from the ground up to take full advantage of everything Bun offers.

### For Developers and Editors Alike

Most CMSs force a tradeoff: developer control or editor experience. Glaze refuses to choose.

- **Developers** get full schema control in code, type safety, and extensibility
- **Editors** get a clean, intuitive admin UI that just works
- **Both** benefit from a system that stays in sync and never breaks silently

### Philosophy: Standing on Giants

We don't reinvent wheels. Glaze composes best-in-class libraries into a cohesive CMS:

- **Bun.sql** for native database connectivity
- **Drizzle** for type-safe schema management
- **Elysia** for Bun-native API routing
- **Better-Auth** for authentication
- **TanStack Start** for SSR admin UI

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

## The Convergence Engine

Schema drift is inevitable. Developers edit code, admins tweak settings, databases get modified directly. Most CMSs break silently when this happens. Glaze detects it.

**Convergence** is a three-way sync engine that keeps your code, database, and admin UI in harmony:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Schema    │◄───►│  Database   │◄───►│  Admin UI   │
│   Files     │     │             │     │   Editor    │
└─────────────┘     └─────────────┘     └─────────────┘
        ▲                                      │
        └──────────────────────────────────────┘
                    Convergence Engine
```

**On startup in development**, Convergence tells you exactly what changed:

```
⚠️  Schema drift detected!

Your database schema does not match your schema files.

  1) Accept database schema (update code to match DB)
  2) Reject database changes (revert DB to match code)
  3) Show differences
```

### Three-Way Sync

| Direction     | Tool               | Purpose                            |
| ------------- | ------------------ | ---------------------------------- |
| **Code ↔ DB** | drizzle-kit        | Detect drift, generate migrations  |
| **Code → UI** | `getTableConfig()` | Display schema in admin editor     |
| **UI → Code** | ts-morph           | Write changes back to schema files |

No silent failures. No mysterious bugs in production. You see the drift, you decide how to fix it.

---

## Deployment Modes

Like Payload, Glaze gives you flexibility in how you deploy:

### Integrated Mode (Single Process)

Run Glaze inside your TanStack Start app:

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
		handlers: { GET: handle, POST: handle, PUT: handle, DELETE: handle },
	},
});
```

**Best for:** Most projects, simpler deployments, smaller teams

### Separate Mode (Two Processes)

Run Glaze as a standalone server:

```typescript
// server.ts
import { createGlazeServer } from '@glaze/core';

const glaze = createGlazeServer({
	schema: './src/schema.ts',
	database: process.env.DATABASE_URL,
});

glaze.listen(4000);
```

**Best for:** Larger teams, microservices, multiple frontends sharing one CMS

### End-to-End Type Safety with Eden

Both modes support [Eden Treaty](https://elysiajs.com/eden/overview.html) for type-safe API calls — like tRPC, but without code generation:

```typescript
// Fully typed, no codegen needed
const posts = await api().posts.get();
```

---

## Key Features

| Feature                | Description                                                 |
| ---------------------- | ----------------------------------------------------------- |
| **⚡ Bun Native**      | Built exclusively for Bun — not a port, native from day one |
| **🔒 Type-Safe**       | End-to-end type safety from database schema to admin UI     |
| **🔄 Convergence**     | Bidirectional schema sync between code, database, and UI    |
| **🎨 Modern Admin**    | SSR admin panel with TanStack Start                         |
| **🔌 Extensible**      | Elysia plugin system for custom routes and webhooks         |
| **📦 Flexible Deploy** | Run integrated or standalone — your choice                  |

---

## Technology Stack

| Layer       | Technology             | Why?                                        |
| ----------- | ---------------------- | ------------------------------------------- |
| Runtime     | Bun                    | Native TypeScript, fast startup, low memory |
| Database    | Bun.sql + Drizzle      | Native PostgreSQL bindings, type-safe ORM   |
| Backend     | Elysia                 | Built for Bun, type-safe, fastest framework |
| Admin UI    | TanStack Start         | SSR with typed server functions             |
| Auth        | Better-Auth            | Framework-agnostic, battle-tested           |
| Schema Sync | drizzle-kit + ts-morph | Bidirectional code ↔ DB ↔ UI sync           |

---

## Requirements

- **Bun v1.0+** (required — Glaze does not run on Node.js)
- PostgreSQL 15+

---

## Quick Start

> ⚠️ Glaze is in early development. APIs will change.

```bash
# Clone and install
git clone git@github.com:glaze-cms/glaze.git
cd glaze
bun install

# Start development server
bun dev
```

---

## License

MIT

---

_Bun-native. Standing on giants. Shipping fast._
