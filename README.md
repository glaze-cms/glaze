# Glaze

**The Bun-native headless CMS framework.** Your Drizzle schema is the source of truth; Glaze keeps the
database in sync with your code — and, eventually, with non-technical edits from an Admin UI — through a
single **convergence** engine that runs at boot.

> **Status: early / greenfield.** The backend is real and tested end-to-end (API, auth, convergence,
> content CRUD) across Postgres **and** SQLite, on both Bun and Node. The Admin UI, the real-time
> collaboration layer, and `bun create glaze` are **not built yet** — see [Status](#status). Not yet
> published to npm; install from git. APIs will change before `1.0`.

---

## Why Glaze

Glaze is designed **from day one for Bun** — not an adapter, not a port, not a compatibility layer. It
leans on Bun's native speed, low memory, and first-class TypeScript, and it assembles proven tools
(Drizzle, Elysia, Better Auth) into one coherent workflow rather than reinventing them.

The goal is a healthy balance between **developer ergonomics** and **editor experience**: developers
describe content in real TypeScript with Drizzle — no proprietary DSL, no parallel config format — and
editors get a clean, focused admin surface served by the very same process.

### Why another CMS?

Existing systems have real strengths, but also pain points teams have learned to work around:

- Proprietary schema formats and custom query DSLs
- Plugin layers and hidden pipelines that obscure behavior
- Migrations that drift or depend on hidden state
- Admin UIs that feel like a separate, slower product
- Multi-process deployments to stand up and keep in sync

Glaze takes a different line:

- **Schemas are just Drizzle.** Your database structure is defined in code — the single source of truth,
  no parallel format to keep in sync.
- **No magic.** Everything Glaze does is explicit, typed, and traceable. If something breaks, it's visible.
- **One process.** The API, the admin, and (later) real-time collaboration run in a single Bun process —
  one port, one artifact, minimal latency. Node works too, quietly, so nothing locks you in.
- **Convergence keeps schema and database in sync.** No drift, no hidden migration state: at boot Glaze
  reconciles the live database to your Drizzle schema and turns every change into a structured, reviewable
  signal of _what will change_ and _why something can't proceed_ — the foundation for letting
  non-technical users approve schema changes safely, without touching migrations.

## Status

| Area                                                                  | State                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------- |
| HTTP API server (Elysia, Bun + Node)                                  | ✅ Working                                              |
| Convergence at boot (drizzle-kit SDK, PG + SQLite)                    | ✅ Working                                              |
| Auth — Better Auth (email/password cookie session **+** bearer token) | ✅ Working                                              |
| Auto-generated content CRUD API from your Drizzle tables              | ✅ Working                                              |
| Environment validation at boot (fails fast with fix hints)            | ✅ Working                                              |
| Matrix test harness (`{Bun, Node} × {Postgres, SQLite}`)              | ✅ Working                                              |
| Solo workflow                                                         | ✅ Working · Team / audit workflows designed, not wired |
| Admin UI (React)                                                      | 🚧 Planned                                              |
| Real-time collaboration (WebSocket surfacing of schema decisions)     | 🚧 Planned                                              |
| Request validation (`drizzle-typebox`), typed 4xx error mapping       | 🚧 Planned ([tracked](#roadmap))                        |
| `bun create glaze` onboarding · npm publish                           | 🚧 Planned                                              |

## Requirements

- **[Bun](https://bun.sh) 1.3+** (primary), or **Node 22+**.
- **Postgres** (via `postgres.js`) or **SQLite** (`bun:sqlite` on Bun, `better-sqlite3` on Node).

## Quickstart

Glaze ships TypeScript source and is git-installed for now:

```sh
bun add glaze-cms   # illustrative
```

**1. Describe your database — `glaze.config.ts`.** This is the tooling substrate; the CLI and the runtime
read the same file, so there is no separate `drizzle.config.ts`.

```ts
import { defineGlazeConfig } from 'glaze-cms';

export default defineGlazeConfig({
	dialect: 'postgres',
	connection: process.env.DATABASE_URL!, // or a SQLite file path / ':memory:'
	schema: './schema.ts', // a file, or './schema/*.ts'
	migrations: './drizzle',
	workflow: { mode: 'solo' },
});
```

**2. Write your schema as a plain Drizzle module — `schema.ts`.** This is the source of truth.

```ts
import { pgTable, serial, text, boolean } from 'drizzle-orm/pg-core';

export const posts = pgTable('posts', {
	id: serial('id').primaryKey(),
	title: text('title').notNull(),
	published: boolean('published').default(false),
});
```

**3. Boot — `server.ts`.** `glaze()` loads the config, **converges the database to match your schema**,
wires auth, generates a CRUD API for every table, and starts listening.

```ts
import { glaze } from 'glaze-cms';

await glaze(); // auto-loads glaze.config.ts; serves on :4000 (GLAZE_PORT to change)
```

```sh
cp .env.example .env      # set DATABASE_URL and (in prod) GLAZE_AUTH_SECRET
bun server.ts
```

**4. Use it.** Every table becomes a gated REST collection under `/api/{table}`. Authenticate once, then
CRUD:

```sh
# sign up — returns a session cookie (saved to the jar) AND a bearer token
curl -X POST localhost:4000/api/auth/sign-up/email -c cookies.txt \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse-battery","name":"Ada"}'

# create + list (cookie or `Authorization: Bearer <token>`)
curl -X POST localhost:4000/api/posts -b cookies.txt \
  -H 'content-type: application/json' -d '{"title":"Hello"}'
curl localhost:4000/api/posts -b cookies.txt
```

Per collection you get: `GET /api/posts` (list, `?limit=&offset=`), `POST /api/posts` (create),
and — when the table has a single-column primary key — `GET|PATCH|DELETE /api/posts/:id`. Every content
route requires a valid session; unknown body fields are dropped. Opt a table out of being _served_
(while convergence still manages it) with `glaze({ content: { exclude: ['internal_join_table'] } })`.

> **SQLite variant:** set `dialect: 'sqlite'`, `connection: './data.db'` (or `':memory:'`), and import
> your table helpers from `drizzle-orm/sqlite-core`. Everything else is identical — the matrix tests
> prove both dialects behave the same.

See [`.env.example`](./.env.example) for all environment variables (Glaze validates them at boot and
fails fast with a per-variable message + fix hint).

## Configuration split

Two surfaces, on purpose:

- **`glaze.config.ts`** — the side-effect-free _tooling_ substrate the CLI can load **without booting the
  server**: `dialect`, `connection`, `schema`, `migrations`, `workflow`.
- **`glaze({ … })`** — _runtime_ behavior: security (CORS/headers), route prefixes, health check, content
  exposure, logger, and Elysia/Better-Auth extension points.

`connection` and `schema` are needed by both, so they live once in the config file and the runtime reads
them from there — no drift-prone second copy.

## Architecture

Complexity lives deep in the tree; entry points read like a table of contents. Two seams are resolved
once at the composition root and injected inward, so the logic never branches on environment:

- **Runtime seam — Bun vs Node.** Each runtime uses its native-fast primitive (`Bun.file`/`Bun.serve`/
  `bun:sqlite` vs `node:fs`/`@elysiajs/node`/`better-sqlite3`). Node is a quiet capability that removes an
  adoption objection — not a marketed feature.
- **Dialect seam — Postgres vs SQLite.** Kept thin by **delegating dialect-correct DDL to `drizzle-kit`**
  (including SQLite's table-rebuild dance). Glaze orchestrates the SDK and reads its typed JSON envelopes;
  it never hand-writes SQL or branches on dialect.

**Convergence** is built on the `drizzle-kit` programmatic SDK (not on scraping CLI text): each operation
returns a typed `status / errors / payloads` envelope. Those envelopes are the collaboration data model —
"here's what's about to change" for approval, typed error codes for the UI to translate, and a
human-in-the-loop flow for data-loss decisions. It runs at boot with an independent before/after
data-loss check, so a schema change can't silently drop data.

## Development

Everything runs on native-fast tooling. The gate must be green for any change to be "done":

```sh
bun run typecheck   # TypeScript (tsc)
bun run lint        # oxlint (type-aware, via tsgolint)
bun run format      # oxfmt  (--check; `format:fix` to write)
bun test            # Bun runner — full matrix, both dialects
bun run test:node   # the same specs under the Node runner
```

The **Postgres legs of the matrix need a database running** (a local Postgres on `localhost:5432`);
without one they're skipped. SQLite legs run everywhere. Tests are three tiers — unit (co-located),
integration (real ephemeral DB, no mocks), and contract/HTTP (`app.handle(new Request())`) — and one
behavioral spec is expanded across the whole matrix rather than duplicated.

## Tech stack

Elysia 1.4 · Drizzle ORM + drizzle-kit (RC) · Better Auth · `postgres.js` · `bun:sqlite` /
`better-sqlite3` · TypeBox · Pino · oxlint + oxfmt + TypeScript.

## Roadmap

Deferred work and review follow-ups are tracked as issues (the Admin origin + content model, filtering/
sorting/relations, roles + draft/publish, request validation via `drizzle-typebox`, typed 4xx error
mapping, rate limiting, and the WebSocket collaboration layer). The developer-origin CRUD here is the
substrate the rest builds on.

## License

Intended open-source; license TBD.
