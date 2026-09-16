# Glaze

**A headless CMS for people and agents working on the same content, together.** Developers change
the structure in code. Editors change the content in a UI. Agents now do both, on someone's behalf.
Glaze gives all of them one process: every change is proposed, reviewed, approved and applied the
same way, whoever made it — and it works the same for one developer as for a team with non-technical
admins and editors.

**Who it's for:**

- **A solo developer.** Schema in plain Drizzle, converged at boot. Anything that needs a decision is
  asked at the terminal. Migration files only if you want a history.
- **A team.** The same decision is filed as a pending approval, shared in the database, and whoever
  has the `admin` role answers it — with a reason, on the record.
- **Non-technical admins and editors.** Approve a change to the content model without reading a
  migration. Edit content through the same process that serves the site. Proposing a structural
  change from the admin — a team with no developer adding a field — is the next design pass, not a
  feature yet; see [Where this is going](#where-this-is-going).
- **Agents.** An agent works as the person who runs it, through the same review, and its changes are
  recorded under that person. There is no separate path for a machine.

> **Status: early.** The backend is tested end-to-end across Postgres and SQLite, on Bun and Node:
> API, auth, content CRUD, the convergence engine, and a pending-approvals API that holds a change
> until a person approves it. **The admin screen for approvals and content editing is not built
> yet** — today Glaze is a content backend with an approval API. See [Status](#status). Not published
> to npm; install from git. APIs will change before `1.0`.

---

## The idea

The people who change a CMS do not share a process. A developer changes structure through a
migration. An editor changes content through a form. An admin approves nothing, because there is
nothing to approve — the migration ran at deploy, and the form saved on click. Now agents make both
kinds of change, and they inherit the same absence of review.

Glaze puts one loop under all of it: **propose → review → approve → apply.** A developer, an editor,
an admin and an agent are four origins on the same pipeline. The loop is the same at every team size;
what changes is where a decision is answered — the terminal, or the admin screen — and that is one
setting.

**One model, no DSL.** The content model is your Drizzle schema and nothing else. Developers
already know Drizzle, so there is no schema language to learn and no second definition of the model
to keep in sync with the first. The schema file is converged into the database at boot, and the
admin's forms are derived from what the database then holds — `GET /api/entities` serves that
descriptor, with anything an open request would drop marked as pending. An admin sees fields and
entries, not tables and migrations, in a UI built to be obvious to someone who has never opened the
code. Change the schema file and the admin changes. The reverse is the direction:
an editor adds a field from the admin, it is filed for approval like any other change, and once
approved it is written back to the schema file — so code and admin describe the same model whichever
one you changed. The forward half is built; the write-back is the next design pass.

The loop is what makes the structural side safe. A change to the content model is checked against the
rows that exist before it applies, and if it would destroy data, the person answering is shown which
column and how many rows. That is the guarantee: nobody destroys data without being shown what will
be destroyed. But it is a consequence of the review, not the reason for it.

## Convergence — the engine

At boot, Glaze reconciles the live database to your Drizzle schema. It is built on the `drizzle-kit`
programmatic SDK: drizzle computes every diff and every line of dialect-correct DDL, including
SQLite's table rebuild. Glaze never hand-writes SQL.

Glaze adds the part drizzle does not do: deciding whether a change is safe against the rows that
exist.

**Every change is classified into one of three kinds.**

- **Additive** — a new table, a new nullable column, a widened type. Applies.
- **Destructive** — a drop, a narrowing, a `NOT NULL` over existing data. Measured against the live
  database, and held only when the measurement finds something. A column drop is held because the
  column holds data, not because it is a drop.
- **Unclassified** — an operation the classifier does not recognise. Held, and reported as unknown.

**Destructive changes are measured, not assumed.** Five probes run against the live database before
anything applies. drizzle-kit's own data-loss check misses cases — verified against rc.4, where the
low-level `pushSchema` dropped a populated column without a warning:

| Probe                       | Catches                                                   |
| --------------------------- | --------------------------------------------------------- |
| `column_has_data`           | dropping a column that still holds values                 |
| `not_null_existing_nulls`   | adding `NOT NULL` to a column with NULLs                  |
| `not_null_column_non_empty` | a new `NOT NULL` column, no default, on a non-empty table |
| `unique_duplicates`         | a new `UNIQUE` where duplicates exist (collation-aware)   |
| `column_length_overflow`    | narrowing a column below values that exist (Postgres)     |

Each finding carries the affected row count. A probe that cannot determine safety reports
`could_not_verify`, and the change is treated as unsafe.

**Apply is transactional and independently verified.** Row counts are captured before and after inside
the transaction; a loss nobody declared rolls the change back. This check is separate from the probes,
so a gap in one is not a gap in the other.

**A held change becomes a pending approval**, recorded in the database as an append-only event trail
with the statements, the findings, and a hash of the decisions that produced it. Approving re-verifies
the change, re-measures the counts, and applies through the same check. If the database changed
underneath, the request is superseded, not applied. Boot reconciles open requests against the snapshot
chain and the live database. A developer answers at the terminal; with `workflow.audit: true` the
question goes to the admin instead.

Design of record: [`specs/design/convergence.md`](./specs/design/convergence.md) and
[`specs/design/pending-approvals.md`](./specs/design/pending-approvals.md).

## Status

| Area                                                                                | State                                  |
| ----------------------------------------------------------------------------------- | -------------------------------------- |
| HTTP API server (Elysia 2, Bun + Node)                                              | ✅ Working                             |
| Convergence at boot — drizzle-kit SDK, PG + SQLite                                  | ✅ Working                             |
| Classifier (additive / destructive-measured / unclassified)                         | ✅ Working                             |
| Data-loss probes + transactional apply with before/after check                      | ✅ Working                             |
| Pending approvals — append-only trail, boot reconciliation                          | ✅ Working                             |
| Approvals API — `GET /pending-approvals`, `POST …/:id/approve`, `POST …/:id/reject` | ✅ Working                             |
| Roles — `admin` / `editor` / `user`, first-admin claim at `POST /setup/first-admin` | ✅ Working (placeholder for real RBAC) |
| Auth — Better Auth (email/password cookie session + bearer token)                   | ✅ Working                             |
| Auto-generated content CRUD API from your Drizzle tables                            | ✅ Working                             |
| Content descriptor marks what an open request would drop                            | ✅ Working                             |
| Request validation (TypeBox from your schema) + `{success,data,error}` responses    | ✅ Working                             |
| Typed 4xx for DB constraint violations (unique/FK/not-null/check, PG + SQLite)      | ✅ Working                             |
| API reference docs — Scalar / Swagger at `/openapi`                                 | ✅ Working                             |
| Environment validation at boot                                                      | ✅ Working                             |
| Matrix test harness (`{Bun, Node} × {Postgres, SQLite}`)                            | ✅ Working                             |
| Admin — auth shell and layout                                                       | ✅ Working                             |
| **Admin — the approve/reject screen**                                               | 🚧 Next                                |
| `glaze migrate` — apply and close the request from the terminal                     | 🚧 Planned                             |
| Apply path for committed migration files (`migrations.enabled: true` on deploy)     | 🚧 Planned                             |
| `autoApply` and the `.glaze/` cache behind `migrations.enabled: false`              | 🚧 Planned (setting is inert today)    |
| Baselining an existing database                                                     | 🚧 Planned                             |
| Real RBAC (policy model with `propose` / `approve` as first-class actions)          | 🚧 Planned                             |
| Editors propose structural changes from the admin (the `ui` origin)                 | 🔭 Direction                           |
| Content collaboration — per-suggestion review of proposed edits                     | 🔭 Direction                           |
| Real-time notification (WebSocket; polling today)                                   | 🔭 Deferred                            |
| `bun create glaze` onboarding · npm publish                                         | 🔭 Deferred                            |

The dependency order for the planned items is in
[`pending-approvals.md` § Still to build](./specs/design/pending-approvals.md#still-to-build).

## Requirements

- **[Bun](https://bun.sh) 1.4+** (primary) or **Node 24+**.
- **Postgres** (via `postgres.js`) or **SQLite** (`bun:sqlite` on Bun, `node:sqlite` on Node).

## Quickstart

Glaze ships TypeScript source and is git-installed for now.

**1. Describe your database — `glaze.config.ts`.** The CLI and the runtime read the same file; there
is no separate `drizzle.config.ts`.

```ts
import { defineGlazeConfig } from 'glaze-cms';

export default defineGlazeConfig({
	dialect: 'postgres',
	connection: process.env.DATABASE_URL!, // or a SQLite file path / ':memory:'
	schema: './schema.ts', // a file, or './schema/*.ts'
	migrations: { enabled: true, path: './drizzle' }, // keep a committed file per change
	workflow: { audit: false }, // false: answer held changes at the terminal · true: on the admin
});
```

`audit` does not decide whether a destructive change is held — it always is. It decides where the
answer comes from.

**2. Write your schema as a plain Drizzle module — `schema.ts`.**

```ts
import { pgTable, serial, text, boolean } from 'drizzle-orm/pg-core';

export const posts = pgTable('posts', {
	id: serial('id').primaryKey(),
	title: text('title').notNull(),
	published: boolean('published').default(false),
});
```

**3. Boot — `server.ts`.** `glaze()` loads the config, converges the database to the schema, wires
auth, generates a CRUD API for every table, and starts listening.

```ts
import { glaze } from 'glaze-cms';

await glaze(); // auto-loads glaze.config.ts; serves on :4000 (GLAZE_PORT to change)
```

```sh
cp .env.example .env      # set DATABASE_URL and (in prod) GLAZE_AUTH_SECRET
bun server.ts
```

**4. Use it.** Every table becomes a gated REST endpoint under `/api/{table}`.

```sh
# sign up — returns a session cookie (saved to the jar) AND a bearer token
curl -X POST localhost:4000/api/auth/sign-up/email -c cookies.txt \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse-battery","name":"Ada"}'

# the first account to claim it becomes admin; the route refuses everyone once an admin exists
# (set GLAZE_SETUP_TOKEN before strangers can reach the server, and send it as x-glaze-setup-token)
curl -X POST localhost:4000/api/setup/first-admin -b cookies.txt

# create + list (cookie or `Authorization: Bearer <token>`)
curl -X POST localhost:4000/api/posts -b cookies.txt \
  -H 'content-type: application/json' -d '{"title":"Hello"}'
curl localhost:4000/api/posts -b cookies.txt
```

Per entity: `GET /api/posts` (list, `?limit=&offset=`), `POST /api/posts` (create), and — when the
table has a single-column primary key — `GET|PATCH|DELETE /api/posts/:id`. Every content route requires
a session; bodies are validated against your schema (TypeBox) and unknown fields are dropped; every
response is a `{ success, data, error }` envelope. Constraint violations validation cannot pre-empt — a
duplicate key, a missing foreign key — come back as a typed 4xx (`CONFLICT` / `FOREIGN_KEY` / …), not
a 500. Opt a table out of being served (convergence still manages it) with
`glaze({ content: { exclude: ['internal_join_table'] } })`.

**5. Change the schema.** Drop `published` from `schema.ts` and boot again. If the column holds data,
Glaze does not apply — it reports which column, how many rows, and asks. With `workflow.audit: true`
the same question is filed as a pending approval an `admin` answers over the API:

```sh
curl localhost:4000/api/pending-approvals -b cookies.txt
curl -X POST localhost:4000/api/pending-approvals/<id>/approve -b cookies.txt
curl -X POST localhost:4000/api/pending-approvals/<id>/reject -b cookies.txt \
  -H 'content-type: application/json' -d '{"reason":"we still need this"}'
```

**Explore it.** API reference docs are generated from your schema at
[`/openapi`](http://localhost:4000/openapi) (Scalar by default; `glaze({ docs: { provider: 'swagger' } })`
for Swagger UI). The auth API has its own reference at `/api/auth/reference`.

> **SQLite:** set `dialect: 'sqlite'`, `connection: './data.db'` (or `':memory:'`), and import your
> table helpers from `drizzle-orm/sqlite-core`. Everything else is identical.

See [`.env.example`](./.env.example) for all environment variables. Glaze validates them at boot and
reports each missing or malformed one with a fix.

## Why another CMS

- **Schemas are just Drizzle.** No proprietary schema format, no parallel config to keep in sync.
- **Built on Drizzle, Elysia and Better Auth, on Bun.** Glaze does not reinvent the ORM, the HTTP
  server or auth. Each of those is a project larger and better maintained than a CMS-internal version
  would be, and one you may already use. What Glaze adds is the layer between them — convergence,
  approvals, and the admin — and nothing underneath.
- **Structural change is reviewable by someone who does not write migrations.** Findings are typed
  codes with row counts, so a screen can translate them.
- **No hidden pipeline.** Everything Glaze does is explicit and typed. When it refuses, it says why.
- **One process, on Bun and Elysia.** The API and the admin run in a single process — one port, one
  artifact — on a runtime and an HTTP framework chosen for speed and low memory, with TypeScript
  native to both. Node 24 works too, behind a seam.

## Configuration split

- **`glaze.config.ts`** — the tooling substrate the CLI can load without booting the server:
  `dialect`, `connection`, `schema`, `migrations`, `workflow`.
- **`glaze({ … })`** — runtime behavior: security (CORS/headers), route prefixes, health check, content
  exposure, logger, and Elysia/Better-Auth extension points.

`connection` and `schema` are needed by both, so they live once in the config file.

## Architecture

Two seams are resolved once at the composition root and injected inward, so the logic never branches
on environment:

- **Runtime seam — Bun vs Node.** Each runtime uses its native primitive (`Bun.file`/`Bun.serve`/
  `bun:sqlite` vs `node:fs`/`@elysia/node`/`node:sqlite`).
- **Dialect seam — Postgres vs SQLite.** Dialect-correct DDL is delegated to `drizzle-kit`; Glaze
  reads its typed JSON envelopes and never branches on dialect. The seam also owns transactions:
  `bun:sqlite`'s `Database.transaction` is synchronous, so Drizzle's `transaction` through it does not
  roll back; the seam's `queryTransaction` does.

The human decisions — `resolve`, `confirmLoss`, `confirmDrop` — are injected as functions, so the
engine is testable without a UI and the approvals API is one more caller of the same seams.

## Development

The gate must be green for any change to be done:

```sh
bun run typecheck    # TypeScript (tsc), every package
bun run lint         # oxlint (type-aware)
bun run format       # oxfmt  (--check; `format:fix` to write)
bun run test         # glaze-cms — the full matrix, both dialects
bun run test:admin   # glaze-admin — runs from its package so it gets its DOM preload
bun run test:node    # the glaze-cms specs under the Node runner
```

Use `bun run test`, not bare `bun test`: the bare form runs the admin's tests without a DOM. The
Postgres legs need **Docker** — the harness provisions an ephemeral `postgres:16-alpine` per test
through Testcontainers and skips that leg when no daemon is reachable. Tests are three tiers: unit
(co-located), integration (real ephemeral DB, no mocks), and contract/HTTP (`app.handle(new Request())`).
One behavioral spec is run across the whole matrix rather than duplicated per target.

Convergence and every data-safety path get adversarial review before merge: one implementer, two or
more reviewers in separate contexts. Both design documents record what those reviews found.

## Tech stack

Elysia 2 · Drizzle ORM + drizzle-kit (RC) · Better Auth · `postgres.js` · `bun:sqlite` /
`node:sqlite` · TypeBox · Pino · oxlint + oxfmt + TypeScript.

## Where this is going

The structural half of the loop exists. The content half is the same loop applied to editing, and it
is a direction, not a promise:

- **Editors propose structural changes.** An admin adds a field from the screen. The change is filed
  as a pending approval like any other and a second person answers it — nobody read it in a pull
  request, so it always needs one. The approval record already carries this origin; the entry point
  and the write-back to the schema file do not exist yet.
- **Suggestions, not drafts.** A colleague or an agent proposes edits to an article; a reviewer accepts
  or rejects each change, not the whole document.
- **A declared frontend contract.** The site declares which fields it consumes, so a structural change
  can be answered with "this breaks the article page".
- **Not planned:** live co-editing, presence, or a large-team permissions matrix.

## License

Intended open-source; license TBD.
