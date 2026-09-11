# drizzle-kit 1.0 RC — SDK deep dive (convergence prerequisite)

> **Status:** research complete (2026-07-19). This is the gated prerequisite to convergence
> (CLAUDE.md §4/§11). No convergence code has been written. Findings below are **empirically
> verified** against `drizzle-kit@1.0.0-rc.4` + `drizzle-orm@1.0.0-rc.4` (probed in a throwaway
> scratch project, running real `generate`/`push` under Bun 1.3.14), not read from docs alone.

## 0. Version landscape — **target the `rc` channel, NOT `beta`** (decided, with evidence)

- npm `latest` is still **`0.31.10`** (old stable). The 1.0 line ships under dist-tags: **`rc` →
  `1.0.0-rc.4`**, `beta → 1.0.0-beta.22`, plus many feature tags (incl. an **`ai`** pre-release —
  relevant to the later AI-integration goal).
- **`beta` is a stale/frozen tag; `rc` is the live forward channel.** Publish timestamps:
  `1.0.0-beta.22` = **2026-04-16**; `1.0.0-rc.1` = 2026-05-01; **`1.0.0-rc.4` = 2026-06-27** (the
  single most-recent publish of the entire package; npm `modified` matches it). The team advanced
  from beta → rc in May and kept shipping on `rc` through late June; `beta` has not moved in ~3
  months.
- **This is not cosmetic — it gates the whole thesis.** Verified: **beta.22 exports only `.` +
  `./api-{postgres,mysql,sqlite}`** — it has **no `drizzle-kit/cli`, no `payload/*`, no `skills/`**.
  The entire envelope SDK (`generate`/`push`/`check` with `status`/`missing_hints`/`Hint`/`--output
json`), the typed error codes, and the agent skills are **`rc`-channel-only**. On `beta` you'd be
  back to only low-level snapshot primitives (≈ glaze-old's manual approach). So convergence's
  collaboration-envelope model **only exists if Glaze depends on `@rc`.**
- Install target for convergence: `drizzle-kit@rc` + `drizzle-orm@rc`, **pinned to the exact
  `1.0.0-rc.N`** (a moving RC — pin, don't float; re-verify the surface on each bump).
- Deps drizzle-kit pulls: `@drizzle-team/brocli` (CLI framework), `esbuild`, `jiti`,
  `get-tsconfig`, `@js-temporal/polyfill`. Peer driver packages (`pg`, `better-sqlite3`, …) are
  the consumer's to install.

## 1. Two API layers (this is the core structural fact)

drizzle-kit RC exposes **two distinct programmatic surfaces**. Choosing between them per-operation
is the central convergence design decision.

### A. High-level "envelope SDK" — `drizzle-kit/cli`

```ts
import { generate, push, pull, up, check, exportSql } from 'drizzle-kit/cli';
```

- **CLAUDE.md §4 was correct**: these live in `drizzle-kit/cli`. (The main `drizzle-kit` entry
  exports only `{ Config, defineConfig }`. The official `drizzle-responses-and-errors` SKILL.md
  example `import { generate } from 'drizzle-kit'` is **stale for rc.4** — it's `/cli`.)
- Fully typed. `cli.d.ts` also exports the types `Hint`, `MissingHint`, `GenerateOptions`,
  `PushOptions`, `CheckOptions`, `PullOptions`, `UpOptions`, `ExportOptions`.
- Each fn takes **inline options** (`{ dialect, schema: <path>, out: <dir>, url?, hints? }`) and
  returns the **status-discriminated JSON envelope** (§2). `output` is forced (SDK always returns
  the envelope; never prompts). **No `drizzle.config.ts` file required** — verified generating with
  pure inline opts and no config on disk. Glaze derives these from `glaze.config.ts`.
- `schema` is a **file path/glob** — the high-level SDK imports the schema module itself (via
  jiti/esbuild). Glaze must give it a resolvable path (glaze.config.ts already carries `schema`).

### B. Low-level "snapshot/apply primitives" — `drizzle-kit/api-<dialect>` & `drizzle-kit/payload/<dialect>`

```ts
import { generateDrizzleJson, generateMigration, pushSchema } from 'drizzle-kit/api-postgres';
import { generateDrizzleJson, generateMigration, pushSchema } from 'drizzle-kit/payload/sqlite';
```

- `generateDrizzleJson(imports, prevId?, schemaFilters?) → Promise<Snapshot>` — schema **module
  object** (not a path) → snapshot.
- `generateMigration(prev, cur) → Promise<string[]>` — diff two snapshots → SQL statements.
- `pushSchema(imports, db, migrationsConfig?) → Promise<{ sqlStatements, hints, apply() }>` —
  computes SQL + advisory hints **without applying**, returns an `apply()` closure.
- **Dialect asymmetry (rc.4):** Postgres's full low-level API is in **`api-postgres`**; SQLite's
  `api-sqlite` is **studio-only** — its `generateDrizzleJson`/`generateMigration`/`pushSchema` live
  in **`payload/sqlite`**. To get one consistent surface across both dialects, import Postgres from
  `payload/postgres` and SQLite from `payload/sqlite` (both re-export the same 5 names).
- **Injected driver, different shapes per dialect:** postgres `pushSchema` wants a drizzle
  `PgAsyncDatabase` (`drizzle-orm/pg-core/async`); sqlite `pushSchema` wants a custom
  **`SQLiteClient`** — `{ query<T>(sql, params?): Promise<T[]>; run(sql): Promise<void>;
batch(stmts): Promise<void> }`. Trivial to implement over `bun:sqlite` (verified, §4).

## 2. The envelope (status-discriminated union — the collaboration data model)

Identical for CLI `--output json` stdout and the `/cli` SDK return value. Discriminator = `status`.

| status          | exit | shape                                            |
| --------------- | ---- | ------------------------------------------------ |
| `ok`            | 0    | `{ status, dialect, …per-op }`                   |
| `no_changes`    | 0    | `{ status, dialect }`                            |
| `missing_hints` | 2    | `{ status, unresolved: readonly MissingHint[] }` |
| `error`         | 1    | `{ status, error: { code, ...meta } }`           |

Per-op `ok` extras: `generate → { migration_path }` · `push → { dialect }` ·
`pull → { schemaPath, snapshotPath, relationsPath?, migrationPath? }` ·
`export → { statements, warnings }` · `up → { upgraded: string[] }` ·
`--explain → { statements, hints }`.

> **CLAUDE.md §4 correction:** the envelope keys are `status` / `error.code` / `unresolved`
> (+ per-op `statements`/`hints`), **not** the imagined "`status`/`errors`/`payloads`". Directionally
> right, specifics different. The mapping table in §4 should be rewritten to these real keys.

**`error.code` is typed as open `string`, not a literal union.** The skills document ~15 codes
(`config_validation_error`, `unsupported_schema_change`, `database_driver_error`, `invalid_hints`,
`query_error`, `check_error`, `orm_version_error`, …) but the type is `code: string`. → Glaze's
i18n `ErrorCode` mapping must handle an **open set** with a default fallback; no exhaustive
type-level switch. `unsupported_schema_change` variants are all mysql/singlestore/mssql — **none for
postgres/sqlite**, so it effectively won't fire for Glaze's two dialects.

## 3. The human-in-the-loop protocol (`missing_hints` → `Hint[]` → re-invoke)

This _is_ the collaboration engine the WebSocket surfaces to non-technical users — and it is
**already typed and shipped**, not something Glaze invents.

```ts
type MissingHint =
	| { type: 'rename_or_create'; kind: K; entity: IdFor<K> }
	| ({ type: 'confirm_data_loss'; kind: K; entity: ConfirmIdFor<K> } & (
			| { reason: 'non_empty' }
			| { reason: 'table_recreate' }
			| { reason: 'type_change'; reason_details: { from: string; to: string } }
	  ));

type Hint =
	| { type: 'rename'; kind: K; from: EntityTuple; to: EntityTuple }
	| { type: 'create'; kind: K; entity: EntityTuple }
	| { type: 'confirm_data_loss'; kind: K; entity: EntityTuple }; // reason dropped in reply
```

Loop: call → if `missing_hints`, map each `unresolved[i]` to exactly one `Hint` → re-invoke with
`hints: Hint[]` (or CLI `--hints` / `--hints-file`) → repeat until `ok`. Partial replies re-return
`missing_hints`. Bad replies → `error` / `invalid_hints`.

- Entity tuples are namespaced & uniform: `table [schema,name]`, `column [schema,table,name]`, …
  Schemaless dialects (sqlite) use a synthesized `'public'` placeholder in slot 0 — echo verbatim,
  never build a real `schema` hint from it.
- **`confirm_data_loss` reasons & where they can be known:**
  - `non_empty` (target has ≥1 row) — **data-derived, needs a live DB** → push-time only.
  - `type_change` — column SQL type changed — data/DB-derived → push-time.
  - `table_recreate` — **sqlite only**; adding `NOT NULL` has no in-place path → confirming
    recreates the table and wipes rows.
- **Verified:** a rename ambiguity (`nickname`→`handle`) surfaced as `missing_hints`
  (`rename_or_create`, kind `column`) from **file-only `generate`** under Bun; resolving it as
  `rename` produced the minimal `ALTER TABLE … RENAME COLUMN` instead of drop+create.

> **⚠️ This gating is NECESSARY BUT NOT SUFFICIENT — and glaze-old already proved it.** drizzle-kit
> **does not flag all data-loss scenarios**; per its own skills, server dialects (Postgres) add
> `NOT NULL` / `UNIQUE` / narrower types and just "let the DB reject" — i.e. a **mid-migration
> failure**, never a `confirm_data_loss`. **Do not trust `confirm_data_loss` as the complete
> data-safety oracle.**
>
> **Recovered prior art (port it):** `../glaze-cms-old` (and `../glaze-cms-poc`)
> `packages/convergence/lib/validator/` — `validateDataConstraints()`, commented _"Catches issues
> that drizzle-kit's --explain misses."_ Four pre-apply **live-DB** checks:
> `checkNotNullConstraint` (`COUNT(*) WHERE col IS NULL`), `checkVarcharLength`
> (`COUNT(*) WHERE LENGTH(col) > N` — type narrowing), `checkUniqueConstraint`
> (`GROUP BY col HAVING COUNT(*)>1`), `checkAddColumnNotNull` (non-empty table). In the RC world,
> drive these off the structured `sqlStatements`/snapshot `ddl` diff instead of regex-parsing text,
> but **reuse the COUNT-queries** + the SQL-injection-safe identifier helpers.
> **Atomic apply:** glaze-old `engine/executor/executor.ts` wraps all statements in
> `db.transaction(...)` → rollback on partial failure. **Caveat:** the SQLite rebuild dance's
> `PRAGMA foreign_keys=OFF/ON` is a no-op inside a transaction — verify atomicity/FK integrity on
> the SQLite path specifically.
>
> Convergence adds its own before/after DB verification (row counts/checksums pre-apply → introspect
> post-apply → assert no unintended loss), per CLAUDE.md §7/§8 (_"compare observed outcomes; don't
> trust the diff"_). The four checks become concrete regression specs; §8 reviewers must hunt
> data-loss paths drizzle misses, dialect divergence, and partial-apply gaps. See memory
> `glaze-convergence-data-loss-oracle`.

## 4. Runtime × dialect reality (the KEY open question for convergence)

Empirically established on Bun 1.3.14:

| Operation                                                  | Needs live DB? | Bun + SQLite | Notes                                                                                                                                                            |
| ---------------------------------------------------------- | -------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generate` (`/cli`, file-only)                             | No             | ✅ works     | emits DDL incl. the sqlite rebuild dance; gates only `rename_or_create`                                                                                          |
| high-level `push({url})` (`/cli`)                          | Yes            | ❌ **fails** | drizzle-kit instantiates **`better-sqlite3`**, which **is not supported under Bun** (oven-sh/bun#4290) → `internal_error`. No `bun:sqlite` driver option exists. |
| low-level `pushSchema(imports, client)` (`payload/sqlite`) | Yes (injected) | ✅ works     | with a ~10-line `bun:sqlite` `SQLiteClient` adapter — verified create+insert+drop-column+apply, row survived                                                     |

**The gap — and its solution (SOLVED, verified).** The data-loss gating (`confirm_data_loss:
non_empty` / `type_change` / `table_recreate`) is a **high-level `push`-only** feature (needs live
rows). High-level `push` with **`dialect: 'sqlite'`** hardcodes `better-sqlite3` → Bun-incompatible.
The low-level `pushSchema` runs on Bun (bun:sqlite adapter) but **does no gating** (verified: it
silently dropped a populated column, `hints: []`).

**→ Superseded.** The original conclusion here was to route SQLite convergence through a second
driver to borrow drizzle's high-level gate. Glaze does not do that: it builds its **own** data-loss
oracle (`convergence/safety/`), which covers cases drizzle misses either way (see §3 and
`../design/convergence.md`). The evidence above stands and is the _reason_ the oracle exists — the
recommendation does not. Convergence uses `dialect: 'sqlite'` with `bun:sqlite`, no extra driver.

**⚠️ rc.4 bug (reproducible, verified):** passing the reply hints as an **inline `hints:` array** to
the SDK returns `{ status: 'error', error: { code: 'missing_required_params_error',
params: ['dialect','schema'] } }` even when `dialect` + `schema` are both supplied. **`hintsFile:`
(path to a JSON file) works.** → Glaze resolves decisions via `hintsFile` (write the `Hint[]` to a
temp JSON, pass the path); report the inline-`hints` bug upstream. (Re-test on each rc bump.)

**Node runtime** keeps the simple path: `dialect: 'sqlite'` + `better-sqlite3` works there.

**Postgres push on Bun — VERIFIED.** `push({ dialect: 'postgresql', url })` runs under Bun with
node-postgres (`pg`) installed and returns the envelope fast. **Rough edge:** if `pg` is _missing_,
the run **hangs** instead of returning `required_packages_error` (verified — a 2-min hang) → Glaze
must ensure the driver package is present before invoking. Note drizzle-kit's push uses `pg`
internally regardless of Glaze's own `postgres.js` runtime choice (only inside drizzle-kit's push).

**Postgres gating — VERIFIED, and it confirms the §3 gap:**

- DROP a **populated** column → `missing_hints` / `confirm_data_loss` / `non_empty` ✓ (gated).
- `SET NOT NULL` on a column with existing NULLs → **NOT gated**: push emitted
  `ALTER TABLE "notes" ALTER COLUMN "note" SET NOT NULL` and ran it live → **`error` /
  `query_error`** (DB rejected mid-migration). This is exactly the case glaze-old's
  `checkNotNullConstraint` pre-empts — proven, not hypothesized.

> **Open items still to verify (at convergence start):** (a) does the inline-`hints` bug persist on
> the next rc? (b) full
> before/after transaction-atomicity behavior of `push` on a multi-statement migration where a later
> statement fails (does anything partially apply)?

## 5. Migration folder format (RC = new, v7)

`generate` writes a **directory per migration**, not the classic `NNNN_name.sql` + `meta/_journal`:

```
<out>/<timestamp>_<random_name>/
  migration.sql     # DDL, statements joined by `--> statement-breakpoint`
  snapshot.json     # { version: "7", dialect, id: <uuid>, prevIds: [<uuid>...], ddl: [...] }
```

- `snapshot.json.ddl` is a **flat array of entities**, each discriminated by `entityType`
  (`tables` | `columns` | …) carrying normalized attrs (`type`, `notNull`, `default`, `generated`,
  `table`, …). Diffing two snapshots' `ddl` arrays is a clean structured source for
  human-readable "what will change" — richer than parsing SQL.
- **`prevIds` is an array** → the snapshot graph is a **DAG supporting branches/merges**. Divergent
  branches that don't commute are exactly the `check_error` `kind: 'conflicts'` case (with
  `{ parentId, branches: [{ leafId, leafPath, statementDescription } × 2] }`). **This is the
  substrate for the team-workflow conflict resolution surfaced over WebSocket** — convergence reads
  it, it doesn't build a parallel one.

## 6. SQLite table-rebuild dance is delegated (CLAUDE.md §5 verified)

Adding `NOT NULL` to an existing sqlite column, `generate` emitted the **full 12-step rebuild
itself**:

```sql
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` ( `id` integer PRIMARY KEY, `nickname` text NOT NULL );--> statement-breakpoint
INSERT INTO `__new_users`(`id`,`nickname`) SELECT `id`,`nickname` FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
```

Glaze **never hand-writes** this — the single biggest justification for the thin dialect seam, and
it's real in rc.4. (Returned `status: ok` at generate-time; the _confirmation_ for the row-wipe is a
push-time `confirm_data_loss: table_recreate`, per §4.)

## 7. Surfaces & housekeeping

- **Statement order and generated columns (rc.4, verified 2026-09-11).** Dropping a column and a
  generated column that depends on it in one migration is emitted source-first
  (`DROP COLUMN "src"; DROP COLUMN "dbl";`); Postgres and SQLite both refuse the first statement, so
  the migration can never apply. Also: a required generated column on Postgres is emitted **without**
  `NOT NULL` (`ADD COLUMN "g" integer GENERATED ALWAYS AS (…) STORED`) although the snapshot records
  `notNull: true`, so the database and the snapshot disagree from then on. And the parent snapshot is
  picked by lexical folder sort, so two migrations generated within one second can sort by their
  random suffix — realistic only in tests that commit several migrations quickly.
- **Some diffs produce no migration (rc.4, verified 2026-09-11).** `generate` writes nothing for a
  Postgres column gaining array `dimensions` (`text → text[]`) or a SQLite index becoming unique under
  the same name; `converge` reports `no_changes` while the database stays divergent. `generateDrizzleJson`
  does show the difference, so this is drizzle-kit's differ, not the snapshot. Re-check on each RC bump.

- **Three surfaces, identical envelope:** in-process **SDK** (`drizzle-kit/cli`), **CLI**
  (`drizzle-kit <verb> --output json`), and **MCP** (`drizzle-kit mcp` over stdio exposing
  `generate`/`push`/`check`). **For Glaze (a framework embedding this), the in-process SDK is the
  right surface** — typed returns, no subprocess, no text parsing.
- **Config resolution:** high-level SDK accepts inline opts (no config file needed) → Glaze's CLI
  loads `glaze.config.ts` (side-effect-free) and passes derived opts to the SDK **in-process**. This
  means **convergence does not need drizzle-kit's own CLI or a `drizzle.config.ts` on disk**, and
  the runtime **process-spawn seam is not required for the drizzle-kit happy path** (only for the
  optional Node-subprocess SQLite-push fallback in §4 option 2).
- **Agent skills:** `drizzle-kit skills` installs `SKILL.md`s; the `drizzle` skill runs a
  **staleness check** (`drizzle-kit skills version` vs the embedded revision) — worth wiring into
  Glaze's own dev tooling so an RC bump surfaces loudly.

## 8. Net effect on CLAUDE.md §4

- Keep: "built on the drizzle-kit programmatic SDK, not text-scraping"; `drizzle-kit/cli`;
  non-interactive; envelopes are the collaboration data model; delegate DDL (incl. sqlite rebuild).
- Rewrite: the envelope table to the real keys (`status`/`unresolved`/`error.code` + per-op
  `statements`/`hints`); note `error.code` is an open string (i18n fallback); note the **two-layer**
  API and the **Bun+SQLite push gap** (§4) as the first real design decision convergence must make;
  note the **snapshot DAG (`prevIds`)** as the team-conflict substrate.
