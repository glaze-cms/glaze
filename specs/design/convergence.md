# Convergence — design of record

> Settled 2026-07-20 through a long design pass. Supersedes the workflow framing in
> `../glaze-cms-old/docs/convergence-v2-summary.md` and corrects CLAUDE.md §4 (which overstated the
> WebSocket and treated solo/team as separate flows). A rendered diagram of this model exists as a
> Glaze artifact ("Glaze Convergence — Decision Model").

## The principle

**drizzle computes the change · Glaze applies and guards it.**

- Everything **schema-structural** — diff, DDL generation (incl. the SQLite table-rebuild dance),
  introspection, the snapshot format — is **delegated to drizzle**, always. Reimplementing any of it
  is the maintenance trap the thin dialect seam (§5) exists to avoid; scraping text (glaze-old) is
  never repeated in any form.
- **Execution and data-safety verification stay ours**, always — the transaction/rollback + the
  layer-1/2 oracle — because drizzle's gating is provably incomplete (maintainer experience:
  drizzle did not flag all data-loss; verified in rc.4). See `glaze-convergence-data-loss-oracle`.

## One pipeline

There is **one** convergence pipeline. What people called "solo" vs "team" and "dev" vs "admin" are
not separate flows — they are toggles and input adapters over the same pipeline:

```
trigger → drizzle computes diff → decode envelope → resolve decisions → layer-1 pre-flight
        → audit hold → apply via layer-2 oracle → keep or discard (mode) → (conflicts) → converged
```

## Three orthogonal axes

1. **Origin / trigger** — where the change comes from, and _who resolves its decisions_:
   - **Code (dev):** drift is detected when the **backend API starts** (and on hot-reload). Bulk,
     whole-schema. Intent is _implicit_ (rename vs drop+create?) → decisions arise → **the developer
     resolves** (editor / CLI).
   - **Admin (UI):** an **atomic change hits the API** (POST/PATCH). Granular. Intent is _explicit_
     (they clicked "rename") → mostly only data-loss confirmations → **the administrator resolves**,
     synchronously, in the API response.
2. **Mode (`solo` / `team`) — are the migration files kept?**
   - **No (solo / prototyping):** working snapshot lives in a **gitignored `.glaze/` cache**; commit
     nothing. `db:push`-fast loop, zero repo artifacts.
   - **Yes (team / prod):** the migration + snapshot chain is **committed** — shareable, reviewable
     history.
3. **Audit (`audit: true` / `false`):** hold for explicit approval, or apply as soon as it's safe.

Plus: **conflict resolution comes free** — divergent edits are only possible on a shared, persisted
history, so it exists exactly in `team` mode and is structurally impossible in solo.

## Source of truth: the snapshot

The **snapshot is the authority**, always. Normal operation never introspects the live DB — every
hot path (diff, apply, regenerate `.ts`) works off the tracked snapshot. **Introspection
(`drizzle pull`) is only a bootstrap or repair tool** — adopting a pre-existing DB (mint the first
snapshot) or healing drift after a crash / out-of-band change — and it is delegated to drizzle. It
is _not_ a competing source of truth; it is one way to _produce_ a snapshot.

## Resolution is synchronous — the WebSocket is optional

Resolution binds to **origin**, not to solo/team, and it is **synchronous**:

- admin → resolves in the **API request/response**;
- dev → resolves at **boot / in the CLI**.

The **WebSocket is an optional, team-only real-time sync layer** — it _notifies_ other connected
clients that the schema changed (vs. polling). It was never the resolution channel (glaze-old used
it purely to "notify Admin UI", marked _Optional_). It is **out of the convergence core** and
deferred; the one place a notification is genuinely needed is the async return in team+audit (below),
where polling is an acceptable fallback.

## The hard nucleus: Team + Audit — see `pending-approvals.md`

The quadrant where approval is asynchronous and the change must be held, recorded, and shown to a
person before it applies. **Designed in full in [`pending-approvals.md`](./pending-approvals.md)**;
that document is the design of record for it and is not restated here.

Two things this document said about it are **superseded** there:

- **The pending record is not the generated migration.** Keeping the migration on disk advances the
  snapshot past the database, so the next boot diffs against the advanced snapshot, reports
  `no_changes`, and the drift goes invisible — fail-open. The change is instead generated to learn
  what it does, discarded, and its statements plus an integrity hash recorded; the migration is
  regenerated and hash-verified at approval.
- **`audit` is configuration, not a consequence of `mode`.** The two are independent axes (as the
  three-axes section above already says); `mode` only decides whether the migration file is kept.
  `team` defaults to auditing and `solo` to not, both overridable.

What stands: the DB-table record shared across the team, the expected hash, notification on approval
and rejection, and the watch on stacked changes — which `pending-approvals.md` scopes to the `ui`
origin, since the whole-schema `dev` origin can only ever have one open request.

## Testability (the reason this is tractable)

The axes look combinatorial (origin × solo/team × auto/audit × dialect × runtime) but are **not** —
they are independent toggles over one pipeline, so the suite is **linear**, not the product:

- **Origin** = an input adapter (schema-file → snapshot, or entity-model → snapshot); test each,
  then both feed the identical envelope.
- **Decision resolution** = a pure state machine (`missing_hints` → hints → re-invoke); pure tests.
- **Gate** = a branch at apply (auto applies / audit pends); 2 tests.
- **Persist** = a file writer (`.glaze/` cache vs committed migration); 2 tests.
- **compute → decode → apply** = **one behavioral spec on the real-DB matrix harness** → dialect ×
  runtime for free.

**No mocking of the two things that drift:** drizzle is real (we run actual `generate`), the DB is
real (the ephemeral harness DB is the oracle — assert observed state, not internals). The **only**
injected thing is the **human-in-the-loop as a function** — `resolve(decisions) → hints` and
`approve(pending) → yes/no`. That is a genuine seam, not a mock-of-reality: in production it's the
admin UI / dev CLI; in tests it's a deterministic stub. **Designing the orchestrator to take
`resolve`/`approve` as injected seams, with `mode` and `audit` as configuration, makes it fully
testable today — before the
Elysia API and admin frontend exist — and makes the real UI just another caller later.**

Driver note: **no extra SQLite driver is needed.** `bun:sqlite` covers apply and introspection;
drizzle's high-level `push`/`pull` (the only thing that hardcodes `better-sqlite3`) is avoided on the
hot path.

## Build order

1. **Orchestrator core** — the synchronous happy path covering **solo + team-auto**: trigger →
   compute (drizzle) → decode → resolve-by-origin → layer-1 → apply via the oracle → keep or discard.
   Injection seams (`resolve`/`approve`) and the `mode`/`audit` toggles baked in from line one. Reuses the envelope decoder,
   safety layers, apply oracle, and transaction seam already built + reviewed. Through the §8 loop.
2. **Team+audit pending approvals** — the append-only `approval_events` table, async
   approve/reject, integrity hash, notification. See [`pending-approvals.md`](./pending-approvals.md).
3. **WebSocket** — optional team real-time sync. Deferred; polling is the fallback.

## Known gaps (adversarially reviewed, deferred — 2026-07-20)

The `converge()` facade passed a §8 review (1 implementer : 2 parallel reviewers). Fixed on the spot:
surviving-vs-vanished loss (a **surviving** table that lost rows is `unexpected_data_loss`, never
confirmable/exempted — only a **vanished** table is a confirmable drop); the `audit` snapshot
desync (audit rolled the migration back, there being no durable pending record yet —
`pending-approvals.md` replaces that rollback with a recorded request); apply-failure
fidelity (preserve the failing statement + distinguish `verification_error` as internal); a
concurrent-`out` fail-closed guard; non-`ok` migration sweep; and the `hintsFile` temp-file leak.

**Layer-1 pre-flight is now wired in (2026-07-20).** `converge()` diffs the new snapshot's `ddl`
columns against its parent's, derives `UnsafeChange` descriptors (`drop_column`, `set_not_null`,
`narrow_column`, `add_not_null_column`), and probes the live DB via `detectDataLoss` **before** apply.
A **populated column drop** (`column_has_data`) — the headline count-preserving loss the row-count
oracle can't see — is surfaced to the injected `confirmDrop` seam: confirmed ⇒ applies; declined/absent
⇒ `unsafe_change` (snapshot rolled back, data intact). A change the DB would itself reject
(`not_null_existing_nulls`, `unique_duplicates`, `column_length_overflow`, `could_not_verify`) is a
hard block. In non-interactive contexts confirmation is absent, so destructive changes block rather
than guess (see `glaze-convergence-interactive-resolution`; the TTY/UI confirmer is #20).

Still out of scope for now (each has a follow-up task):

- **Remaining count-preserving corruption.** Layer-1 closes the column-drop hole; a **type
  coercion/rewrite** or a SQLite rebuild `INSERT…SELECT` that lands values in the **wrong columns**
  still preserves row count and slips past both layers. Fix = a future **per-column checksum** in the
  oracle. Current guarantee: _catches net row-count loss, table drops, and populated column drops;
  does not catch value-level corruption within a preserved column count._
- **`confirm_data_loss` runs through the `resolve` seam, not `confirmLoss`.** drizzle's own
  schema-derivable data-loss decisions (`type_change`, `table_recreate`) arrive as `missing_hints`
  and must be answered by `resolve` (`action: 'confirm' | 'reject'`), while the oracle's row-loss uses
  `confirmLoss`. A caller whose `resolve` doesn't handle confirm decisions turns a safe type-change
  into `invalid_hints`. Document the seam contract; consider unifying the two confirm channels at the
  API/UI layer.
- **Internal-namespace scope (settled, wire-when-auth-lands).** The oracle counts only `public`-schema
  tables (Postgres) — which is **correct by design**: Glaze internals live in their own namespaces, so
  they must _not_ be counted as user data. Namespaces: PG `public` = user content, `glaze_auth` = Better
  Auth, `glaze` = other internals; SQLite (no schemas) = `zz__glaze` table prefix (sorts internals last).
  The oracle's "user tables" scope should consume this **via the dialect seam** (exclude the `glaze`
  schemas / `zz__glaze` prefix) rather than hardcoding `public`. Residual, documented gap: a user placing
  _their own_ content in a custom PG schema (advanced usage). Build-time check: drizzle-kit `schemaFilter`
  must include the glaze schemas (defaults to `["public"]`).
- **Rename name-folding.** `information_schema` returns folded names; the rename tuples from drizzle
  are verbatim — a mixed-case _quoted_ table rename can be a false `data_loss` block. (Unquoted /
  lowercased names — the common case — match fine.)
- **`__drizzle_migrations` is not written by converge's apply.** Harmless within converge (it diffs
  against the snapshot), but a double-apply hazard if `drizzle-kit migrate` ever runs the same DB.
  Handle when the `team` mode path lands, alongside a lock serializing convergence on a shared `out`.

## Full-codebase adversarial hunt (2026-07-21)

A four-reviewer §8 sweep of the whole spine + seams. **Fixed on the spot** (each with a regression
test): a **fail-open silent-loss** in the differ (space-joined column keys collided on identifiers
containing spaces → NUL-separated now); a **fail-open desync** (a throwing `confirmDrop`/`confirmLoss`
after generate-write leaked the migration → converge now sweeps + returns a typed error); a **hidden
loss** (the oracle listed `public` tables but counted them unqualified through `search_path` → counts
are now schema-qualified to the listed relation); a **column-rename false-block** (the differ now
consumes drizzle's rename decision instead of re-inferring a `drop_column`); an **atomicity escape**
(a leading comment / embedded `;COMMIT;` bypassed the transaction-control guard → now comment/string
-stripped and scanned per `;`); a **merge fail-open** (`prevIds.length > 1` now fails closed); the
concurrent-`out` guard **no longer deletes a peer's dir**; two **runtime-seam divergences** (Bun
`spawn` now merges env like Node; Node `spawn` reports non-zero on signal death and buffers stdout as
bytes; Node `writeFile` creates parent dirs); `text → varchar(n)` narrowing is now detected; the
decoder captures `--explain` `hints`; `toConvergenceErrorCode` uses `Object.hasOwn` (no prototype
leak); and `quoteIdentifier`'s Postgres-only 63-byte cap was removed (it false-blocked SQLite).

**Deferred** (fail-closed or out-of-scope; tasked): `add_unique` / `char(n)` / `numeric(p,s)` not yet
derived by the differ (the DB rejects them mid-apply → layer-2 rolls back, so safe-but-ugly); FTS5
virtual-table shadow tables can false-block (fail-closed); SQLite FK enforcement is not actually on
(`defer_foreign_keys` is a no-op without `foreign_keys=ON` — the row-count oracle is the guarantee, not
FK); a real `out` lock for concurrent convergence; and configurable `maxRounds`.
