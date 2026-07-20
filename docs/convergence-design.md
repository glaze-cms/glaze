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
        → apply gate → apply via layer-2 oracle → persist toggle → (conflicts) → converged
```

## Three orthogonal axes

1. **Origin / trigger** — where the change comes from, and _who resolves its decisions_:
   - **Code (dev):** drift is detected when the **backend API starts** (and on hot-reload). Bulk,
     whole-schema. Intent is _implicit_ (rename vs drop+create?) → decisions arise → **the developer
     resolves** (editor / CLI).
   - **Admin (UI):** an **atomic change hits the API** (POST/PATCH). Granular. Intent is _explicit_
     (they clicked "rename") → mostly only data-loss confirmations → **the administrator resolves**,
     synchronously, in the API response.
2. **Persist migrations? — this _is_ the solo/team axis:**
   - **No (solo / prototyping):** working snapshot lives in a **gitignored `.glaze/` cache**; commit
     nothing. `db:push`-fast loop, zero repo artifacts.
   - **Yes (team / prod):** the migration + snapshot chain is **committed** — shareable, reviewable
     history.
3. **Apply gate (auto / audit):** apply as soon as it's safe, or hold for explicit approval.

Plus: **conflict resolution comes free** — divergent edits are only possible on a shared, persisted
history, so it exists exactly when `persist = yes` and is structurally impossible in solo.

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

## The hard nucleus: Team + Audit (pending lifecycle)

The **only** quadrant where the approver ≠ the originator and approval is asynchronous. An admin's
atomic change can't apply immediately, so it must live as **pending** until a developer approves it.

- **Pending = a generated-but-unapplied migration.** drizzle's `generate` (write) vs `migrate`
  (apply) split _is_ pending state; `__drizzle_migrations` is the applied-ledger — a migration not in
  it is pending. No bespoke store for the change itself.
- **A Glaze pending-request record** (in a **DB table**, so it's shared/queryable across the team)
  carries the human layer: requester, status, **expected hash** (integrity: the applied migration
  must match what was approved), and the target migration.
- **Lifecycle:** `requested → pending → (approved → applied | rejected)`; the requesting admin is
  **notified** on approval (field goes live) _and_ on rejection (with the reason) — WebSocket if
  connected, poll otherwise.
- **Watch:** stacked pending changes must queue/compose and apply in order; the admin UI shows
  "pending" fields (known to the CMS, not yet live in the DB); hash reconciliation guards integrity.

This complexity is **fully contained to team+audit** and is a deferred, bolt-on extension of the
"await approval" node — the core pipeline (solo + team-auto) needs none of it.

## Testability (the reason this is tractable)

The axes look combinatorial (origin × solo/team × auto/audit × dialect × runtime) but are **not** —
they are independent toggles over one pipeline, so the suite is **linear**, not the product:

- **Origin** = an input adapter (schema-file → snapshot, or collection-model → snapshot); test each,
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
`resolve`/`approve`/`persist`/`gate` as injected seams makes it fully testable today — before the
Elysia API and admin frontend exist — and makes the real UI just another caller later.**

Driver note: **no libSQL is forced.** `bun:sqlite` covers apply and introspection; drizzle's
high-level `push`/`pull` (the only thing that hardcodes `better-sqlite3`) is avoided on the hot path.

## Build order

1. **Orchestrator core** — the synchronous happy path covering **solo + team-auto**: trigger →
   compute (drizzle) → decode → resolve-by-origin → layer-1 → apply via the oracle → persist toggle.
   Injection seams (`resolve`/`persist`/`gate`) baked in from line one. Reuses the envelope decoder,
   safety layers, apply oracle, and transaction seam already built + reviewed. Through the §8 loop.
2. **Team+audit pending lifecycle** — the pending-request ledger table, async approve/reject,
   integrity hash, notification. Contained extension.
3. **WebSocket** — optional team real-time sync. Deferred; polling is the fallback.
