# Pending approvals — design of record

> Settled 2026-09-05. This is the **team + audit** quadrant `convergence.md` calls the hard nucleus,
> designed in full. It supersedes that document's "The hard nucleus: Team + Audit" sketch, which
> assumed the generated migration on disk _is_ the pending record — an assumption that drags the
> snapshot out of lockstep with the database (see [Why the migration is not the record](#why-the-migration-is-not-the-record)).

## The principle

**A change that cannot be applied without a decision is held, recorded, and shown to a person before
it applies.** The record is durable, append-only, and lives in the database so it is shared across
the team.

Git already reviews the change as _written_ — same diff for every environment, before merge.
Convergence reviews the change as _applied_, against one database's real contents, at deploy. A
reviewer reading a pull request cannot see that `posts.subtitle` holds 1,204 rows; that fact does not
exist until the migration is about to run. The two gates catch different things, and the dangerous
sequence is the reviewed, approved, merged change that boots against production and takes the rows
with it.

So the guarantee is not "a second person agreed." It is **nobody destroys data without being shown
what will be destroyed.**

## Three axes

`mode` and `gate` are independent settings that were previously fused in code (`runner.ts` derived
`team → audit`, and `WorkflowConfig` carried no gate at all).

| Axis       | Values           | Answers                             |
| ---------- | ---------------- | ----------------------------------- |
| **mode**   | `solo` / `team`  | Do we keep the migration file?      |
| **gate**   | `auto` / `audit` | Do we ask a person before applying? |
| **origin** | `dev` / `ui`     | Where did the change come from?     |

Defaults: `solo → auto`, `team → audit`. Both overridable — `workflow: { mode: 'team', gate: 'auto' }`
is a legitimate way to work (commit migrations, apply on boot) and is currently inexpressible.

### The matrix

| mode | gate  | origin | What happens                                                                       | Status                       |
| ---- | ----- | ------ | ---------------------------------------------------------------------------------- | ---------------------------- |
| solo | auto  | dev    | Boot detects the change and applies it. No migration file kept.                    | Works today                  |
| solo | auto  | ui     | The click applies immediately; data loss is confirmed inline.                      | Needs the `ui` origin        |
| solo | audit | dev    | Boot detects it, does not apply, files a pending approval.                         | This slice                   |
| solo | audit | ui     | The click files a pending approval; the same person approves it, recorded as such. | Needs the `ui` origin        |
| team | auto  | dev    | Boot generates the migration, commits it, applies it.                              | **Inexpressible today**      |
| team | auto  | ui     | The click applies immediately and writes a migration file.                         | Needs the `ui` origin        |
| team | audit | dev    | Boot files a pending approval; on approval it applies and writes the migration.    | **This slice.** Team default |
| team | audit | ui     | The click files a pending approval; an admin approves it.                          | Needs the `ui` origin        |

Reading across: **`mode` is not a behavioural axis.** It only decides whether the migration file is
kept. Behaviour comes from `gate × origin`.

### `audit` means audit

The gate applies **uniformly across origins and actors**. There is no bypass — not for an admin, not
for the person who made the change. With `audit` on, every structural change becomes a pending
approval and is recorded, even when the same person approves it seconds later. An admin approving
their own change is permitted and recorded **as** a self-approval; what is not permitted is a change
that applies without ever having been a pending approval, because that leaves `audit` on and the
trail incomplete.

Permission answers only **"may you approve?"** — never "may you skip?".

**Distinct from this:** drizzle's own decisions (`rename_or_create`, `confirm_data_loss`) still
resolve **synchronously**, as `convergence.md` requires — they must be answered before a migration
can be generated at all. The gate then holds the generated result. Two different moments.

## Lifecycle

```
schema change detected
  → generate (learn what it does) → discard the migration → record `requested`
  → [ human approves ] → regenerate → verify hash → re-probe → apply → record `applied`
  → [ human rejects  ] → record `rejected` (reason required)
  → [ schema changed ] → record `superseded`, file a new request
  → [ schema reverted ] → record `withdrawn`
```

### Why the migration is not the record

Generating writes a migration to `out`, and that migration carries the new snapshot — so keeping it
advances the snapshot past the database. The next boot then diffs the schema file against the
_advanced_ snapshot, finds them equal, reports `no_changes`, and the drift becomes invisible. That is
fail-open, and it is why the current `gate: 'audit'` path rolls the migration back.

So: **generate to learn what the change does, then discard it, and keep the knowledge.** The
statements and their hash go on the `requested` event. The snapshot never runs ahead of the database,
and every boot re-detects the same pending change — fail-closed by construction rather than by a
bolted-on guard.

At approve time the migration is regenerated and its hash compared to what was approved. Match ⇒
apply. Mismatch ⇒ the schema file moved; the approval is stale and is superseded rather than applied.

This is the same shape as the content-suggestion model: a proposal whose base hash no longer matches
is stale and re-reviewed, never auto-repositioned. Structure and content share one mental model, and
the naming should stay aligned deliberately.

## Storage

First table in the `glaze` internal namespace — Postgres schema `glaze`, SQLite table prefix
`zz__glaze_` (schemaless, so the prefix namespaces and sorts internals last). Materialized
create-once through the dialect seam, as the auth schema is.

### `approval_events` — append-only

One row per event. Nothing is ever updated or deleted; current state is derived.

| Column       | Notes                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `id`         | Event id.                                                                                        |
| `requestId`  | Groups every event of one approval. Indexed.                                                     |
| `type`       | `requested` / `approved` / `rejected` / `applied` / `apply_failed` / `superseded` / `withdrawn`. |
| `changeHash` | Set on `requested`; the dedupe key at boot. Indexed. Null on other types.                        |
| `actorId`    | The principal who acted. Null when Glaze itself acted (`superseded`, `withdrawn`).               |
| `actorKind`  | `user` / `agent` / `system`. Present from day one — free now, unreconstructable later.           |
| `createdAt`  | Event time.                                                                                      |
| `payload`    | Type-specific detail (below).                                                                    |

**Payloads.** `requested`: origin, statements, pre-flight findings, and a human-readable description
("Drops `subtitle` from `posts`"). `rejected`: the reason, required and non-empty — a rejection with
no reason makes the trail useless exactly where it matters. `applied`: the migration name written to
`out`. `apply_failed`: the failing statement and the typed error.

### Derived state

A request is **open** when its latest event is `requested`. Everything else is terminal. There is no
status column to drift out of step with the events.

`apply_failed` is **terminal**: the change is still in the schema file, so the next boot re-detects it
and files a fresh request. Re-approving a failed apply is not a path — fail closed and start over.

### `principal` — the RBAC placeholder

`userId` (the Better Auth user id), `role` (`admin` | `editor`). The first account to sign up becomes
`admin`; every account after is `editor`. Approving requires `admin`.

Deliberately **not** a column on the Better Auth user table, though `glaze-cms-old/docs/rbac.md`
recommended that for request-path performance: `agent` is one of the three principal kinds in
AGENTS.md §1 and will never be a Better Auth user, and this repo's auth schema states — with a
shape-guard test behind it — that it carries no RBAC field on purpose. The real policy model replaces
this table without moving anything else.

## Integrity

**The change hash** covers the ordered migration statements, NUL-separated, plus the parent snapshot
id. NUL rather than a printable separator for the same reason the differ uses it: a space-joined key
collides on identifiers that contain spaces, and that collision fails open.

**The findings do not hash.** "1,204 rows hold data" is a live count that legitimately moves between
request and approval. So at approve time the layer-1 probes re-run and the result must match what was
shown — same findings, same counts. Any difference refuses the approval and re-renders with the new
numbers. Somebody who approved "this drops 12 rows" did not approve "this drops 40,000", and treating
those as one decision is the silent error the oracle exists to prevent.

## At boot

1. Compute the diff with the gate applied.
2. **No changes** — if an open request exists, the schema was reverted: record `withdrawn`.
3. **Changes, same `changeHash` as the open request** — already pending, do nothing.
4. **Changes, different hash** — record `superseded` on the open request, file a new `requested`.
5. Discard the generated migration either way.

Boot **does not fail** on a pending approval. The server starts, the admin is reachable (it is where
the approval happens), and the content API serves what the database actually has.

**Stacking does not arise.** The `dev` origin diffs the whole schema against the snapshot, so there is
only ever one open request; editing the schema again supersedes it rather than queueing beside it.
`convergence.md`'s "stacked pending changes must queue and apply in order" belongs to the `ui` origin,
where two people can propose independently.

## The content API while a change is pending

`loadEntities` builds entities from the **Drizzle schema modules** — the desired state, not the
database. Under a pending change it would therefore advertise and select columns the database does not
have, and every read of that entity would fail. Since `audit` holds additive changes too, this is
certain rather than hypothetical, and it lands on exactly the entity being changed.

**Entities still come from the modules** — the Drizzle table objects are what queries are built from.
The **snapshot filters the column set**: a column the snapshot does not carry is excluded from queries
and reported in the descriptor as pending. This is `content.md`'s "structure stays on the snapshot"
finally being used rather than merely asserted.

| Change            | While pending                                                                                                  | Descriptor        |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ----------------- |
| Add column        | Absent from the DB; excluded from queries.                                                                     | `pending: add`    |
| Drop column       | Still in the DB; still served.                                                                                 | `pending: drop`   |
| Rename            | The DB has the old name. Drizzle's rename decision is captured, so this is one change, not a drop plus an add. | `pending: rename` |
| Narrow / not-null | The column exists and reads normally.                                                                          | `pending: alter`  |

In scope for this slice: the snapshot intersection, the query filtering, and one plain badge in the
admin. Out of scope: per-change-kind UI treatment, which wants real design attention.

## The screen

One authenticated route. Shows the open pending approval — what it does in words, the statements, the
affected tables, the pre-flight findings with their row counts — and offers **approve** and **reject**,
the latter requiring a reason. Both locales; `es.ts` is typed as `Translations`, so drift is a compile
error rather than a TODO.

Endpoints follow the standard envelope and the auth macro:

```
GET  {apiPrefix}/pending-approvals              # open requests, derived from the events
POST {apiPrefix}/pending-approvals/:id/approve  # regenerate, verify, re-probe, apply
POST {apiPrefix}/pending-approvals/:id/reject   # { reason }
```

Approval **applies in-process, in the handler** — regenerate, verify the hash, re-probe, apply through
the oracle. That is the payoff of the injected `resolve`/`confirmLoss`/`confirmDrop` seams: the real
UI becomes just another caller. It holds the request open for seconds; if that becomes a problem the
answer is a job with status polling, but not before the problem is felt.

## Notification

The requester is told when their change is approved or rejected, behind **one internal call**. This
slice implements it by **polling** — the screen refetches. The WebSocket is the next increment and
swaps in behind that call without touching approve/reject. AGENTS.md §11 takes real-time off the
critical path deliberately.

## Recorded reversals

Written down because each is the kind of decision that gets silently re-reverted.

1. **Approval happens in the admin UI, not the CLI.** Both prior implementations put it in the CLI —
   `glaze-cms-old`'s flows #3 and #6 both end "Dev applies via CLI", with the admin UI limited to
   `GET /schema/pending` for visibility. AGENTS.md §1 now requires that a non-technical person can
   approve a schema change without touching migrations, which overrides that. A CLI path stays as the
   escape hatch.
2. **The pending record is not the generated migration.** Supersedes `convergence.md`'s "Pending = a
   generated-but-unapplied migration … no bespoke store for the change itself." See above.
3. **`gate` is config, not derived from `mode`.** `glaze-cms-old` had `{ mode, audit }` as independent
   settings; this repo fused them. Restored.

## Out of scope

- **The `ui` origin.** `converge()` is whole-schema from a schema file; there is no granular
  "someone clicked rename" entry point, and an admin-originated structural change additionally has to
  reach the developer's Drizzle file or the next boot reverts it. That write-back deserves its own
  design pass.
- **The WebSocket** — next increment.
- **Queueing** — arrives with the `ui` origin.
- **The persist axis.** `mode` currently does nothing: the gitignored `.glaze/` cache was never built,
  so solo and team both write to the committed migrations dir. Pre-existing, unchanged here, and worth
  fixing before `solo` is claimed to mean "no migration files".

## Open

- **Should self-approval eventually be disallowed?** Permitted here and recorded as such. Strict
  second-party would let Glaze claim "no structural change reaches production without a second pair of
  eyes" — an enumerable guarantee of the kind AGENTS.md §3 asks for — but it deadlocks a two-person
  team, and §1 targets teams of 2–5. Cheap to flip either way: the actor is already on the event. Best
  answered when the `ui` origin exists and there is a screen attached to it.
- **Where the RBAC placeholder goes when the real policy model lands** — the `principal` table is
  shaped to be replaced, not extended.
