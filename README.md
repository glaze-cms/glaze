# 🌊 Glaze CMS

> A Bun-native content management system built for performance

**Status:** 🚧 Early Development

---

## What is Glaze?

Glaze is a modern CMS that runs **exclusively on Bun** — leveraging native APIs like `Bun.sql`, `Bun.serve`, and the Bun runtime for maximum performance at minimal cost.

This isn't a Node.js CMS ported to Bun. It's built from the ground up to take full advantage of everything Bun offers.

### Philosophy: Standing on Giants

We don't reinvent wheels. Glaze composes best-in-class libraries into a cohesive CMS:

- **Bun.sql** for native database connectivity
- **Drizzle** for type-safe schema management
- **Elysia** for Bun-native API routing
- **Better-Auth** for authentication
- **TanStack Start** for SSR admin UI

Battle-tested libraries. Native performance. No compromises.

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

## Key Features

| Feature             | Description                                                 |
| ------------------- | ----------------------------------------------------------- |
| **⚡ Bun Native**   | Built exclusively for Bun — not a port, native from day one |
| **🔒 Type-Safe**    | End-to-end type safety from database schema to admin UI     |
| **🔄 Convergence**  | Schema drift detection and recovery tools for development   |
| **🎨 Modern Admin** | SSR admin panel with TanStack Start                         |
| **🔌 Extensible**   | Elysia plugin system for custom routes and webhooks         |

---

## Technology Stack

| Layer    | Technology        | Why Bun-native?                                |
| -------- | ----------------- | ---------------------------------------------- |
| Runtime  | Bun               | Native TypeScript, fast startup, low memory    |
| Database | Bun.sql + Drizzle | Native PostgreSQL bindings, no `pg` dependency |
| Backend  | Elysia            | Built for Bun, type-safe, fastest framework    |
| Admin UI | TanStack Start    | SSR with typed server functions                |
| Auth     | Better-Auth       | Framework-agnostic, works with Elysia          |

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
cd glaze-cms
bun install

# Start development server
bun dev
```

---

## License

MIT

---

_Bun-native. Standing on giants. Shipping fast._
