# Pending approvals — design of record

> Settled 2026-09-05, amended 2026-09-05 after the first implementation pass and two adversarial
> reviews. The amendment is not cosmetic: a change is now held for **what it does** rather than for
> a boolean, a deployed server **applies** the committed chain instead of re-deriving it, and a
> developer answers at a terminal rather than waiting for a screen built for someone else. What each
> correction supersedes is recorded under [Recorded reversals](#recorded-reversals).

## The principle

**A change that cannot be applied without a decision is held, recorded, and shown to a person before
it applies.** The record is durable, append-only, and lives in the database so it is shared across
the team.

Git already reviews the change as _written_ — same diff for every environment, before merge.
Convergence reviews the change as _applied_, against one database's real contents, at deploy. A
reviewer reading a pull request cannot see that `posts.subtitle` holds 1,204 rows; that fact does not
exist until the migration is about to run. The two reviews catch different things, and the dangerous
sequence is the reviewed, approved, merged change that boots against production and takes the rows
with it.

So the guarantee is not "a second person agreed." It is **nobody destroys data without being shown
what will be destroyed.**

## The settings

Four things decide what happens to a schema change. Only the first two are workflow config; the
third is per machine and the fourth is a permission.

| Setting     | Values             | Decides                                                         |
| ----------- | ------------------ | --------------------------------------------------------------- |
| `mode`      | `solo` / `team`    | push, or committed migrations                                   |
| `audit`     | `false` / `true`   | a held change is answered at a terminal, or on the admin screen |
| `autoApply` | `false` / `true`   | does this machine apply anything at boot                        |
| role        | `admin` / `editor` | who may approve                                                 |

**`mode` is behavioural.** Keeping the migration files is not a filing preference: a committed chain
is a thing you _apply_. With `solo`, every machine diffs the schema against the database and applies
directly, keeping no files — a deployed server does what the laptop does. With `team`, the developer
generates and commits, and every other machine runs the committed chain, with drizzle's own journal
recording which migrations this database has already run.

**`audit` does not decide whether a dangerous change is held.** It is always held. A safety promise
with an off switch is not a promise. `audit` decides where the answer comes from: `false` asks at the
terminal and fails closed when there is no terminal; `true` files a pending approval and lets a
person answer on a screen.

Defaults: `solo → audit false` (you are at a terminal, so answer), `team → audit true` (other people
are not at your terminal). `autoApply` follows the old `autoRun`: on for a developer, off for
production.

## What is held, and what is not

**A change that destroys data is held. Everything else applies.**

This is the mechanism finally matching the principle. Earlier drafts of this document held _every_
structural change behind a boolean, which is both more ceremony than the promise needs and less
protection than it implies. Adding a column is not dangerous and buys nothing by waiting. Dropping a
populated one is the entire reason this feature exists.

"Destroys data" is not a judgement call — the layer-1 oracle already probes what a change would do
to the rows that are actually there, and this reuses that answer exactly:

- **Safe** (no findings): nothing that exists stops existing. Applies.
- **Destructive** (`column_has_data`): dropping a column that holds values. Perfectly valid SQL — the
  database will do it without complaint, so the only question is whether you want it. Held for a
  person.
- **Impossible** (everything else): `NOT NULL` on a column holding nulls, a unique index over
  duplicates, a probe that could not answer. The database refuses it outright, so there is nothing to
  say yes to. Fails closed at boot, audited or not.

The code calls the middle one _confirmable_ and the last one _blocking_, after the seam that asks
(`confirmDrop`) and what the engine does with it. Those name the plumbing; these name the change.

### Why Glaze probes when drizzle already asks

Drizzle catches the **destructive** case: dropping a populated column raises `confirm_data_loss` with
reason `non_empty`. It does **not** catch the impossible one — `SET NOT NULL` on a column holding
nulls is emitted as an ordinary `ALTER` and the database rejects it mid-migration. Both were verified
against the RC (`specs/research/drizzle-kit-rc-1.0-sdk.md` §"Postgres gating"), and the second is the
case the previous implementation's `checkNotNullConstraint` existed to pre-empt.

So layer-1's headline job is the **impossible** class: turning a half-applied migration into a clean
refusal before anything runs. On the destructive class it overlaps with drizzle, deliberately, because
the two answer different questions:

- Drizzle answers **"does this need a decision?"** — yes, somebody must confirm.
- The probe answers **"what will it cost?"** — 1,204 rows hold a value.

Only the second can be shown to a person. "This change requires confirmation" tells an approver
nothing; "this drops `subtitle`, and 1,204 rows have data in it" is the whole product. That is also why
`confirm_data_loss` is never treated as complete on its own.

**The promise is precise, and narrower than it sounds.** The oracle detects data loss. It does not
detect an `ALTER` that locks a large table for four minutes, or an index build over ten million rows.
Those are safe by this definition and can still take a site down. Holding protects data, not uptime,
and should not be described as catching dangerous changes in general.

### The second trigger: a change nobody reviewed

A `dev`-origin change has already been read by a person — it went through a pull request before it
could reach a schema file. A `ui`-origin change has not: someone clicked a button and the schema
moved. That is not dangerous because it destroys data; it is unreviewed.

So a `ui` change is also held — **but only when the person who made it cannot approve it.** This is
the difference between a team with developers and a team without, and it is a permission, not a
workflow setting: give editors `propose` and withhold `approve`, and their changes queue for someone
who has it. AGENTS.md §1 already commits to this ("an actor granted `propose` and never `approve`
cannot write to production **by policy**").

**A team of only editors and non-technical admins must be able to work.** They are who the thesis is
for. Their admin holds `approve` — the first account to sign up becomes `admin` — so their safe
changes apply immediately and their destructive ones are held, shown, and approved by them. That
self-approval is not ceremony: the value was never a second signature, it is being shown the row
counts before agreeing, and one person can be shown a number.

### Permission answers "may you approve", never "may you skip"

Holding applies uniformly across origins and actors. There is no bypass — not for an admin, not for
the person who made the change. What is not permitted is a destructive change that applies without
ever having been recorded.

**Distinct from this:** drizzle's own decisions (`rename_or_create`, `confirm_data_loss`) still
resolve **synchronously**, as `convergence.md` requires — they must be answered before a migration
can be generated at all. The hold then applies to the generated result. Two different moments.

## Lifecycle

```
destructive change detected
  → record `requested` with the statements and the live row counts
  → [ somebody is here ]  answer now — terminal, `glaze migrate`, or an inline UI confirm
  → [ nobody is here   ]  it stays pending until a person answers it
  → approved → apply → record `applied`
  → rejected → record `rejected` (reason required)
  → [ schema changed  ] → record `superseded`, file a new request
  → [ schema reverted ] → record `withdrawn`
  → [ applied elsewhere ] → record `applied`, noting it happened outside Glaze
```

**Pending is a state, not a route.** A record is written for every held change; "pending" is only
what it is called while nobody has answered. A developer at a terminal answers immediately and the
request is never pending for a human-perceptible moment — but it is still recorded, with who agreed
and what the counts were.

### An approval belongs to one database

An answer given against one database does not transfer to another. Your laptop has no rows in
`posts.subtitle`; production has 1,204. Confirming the drop locally cannot authorise it in
production, because the thing being agreed to is not the same thing.

This falls out of the design rather than needing machinery: the trail lives **inside the database
being changed**, not in the repository. Staging and production each hold their own decision, and each
sees its own numbers. The same committed migration is therefore approved more than once, on purpose.

### Why the migration is not the record

This holds **when nothing tracks what has been applied**, which is the `solo` case and was the only
case earlier drafts considered.

Keeping a generated-but-unapplied migration on disk advances the snapshot past the database. The next
boot then diffs the schema against a snapshot that already contains the change, reports `no_changes`,
and the drift goes invisible — fail-open, and in the direction that hides exactly what this feature
exists to show. So under `solo` the change is generated to learn what it does, discarded, and its
statements plus a fingerprint recorded; the migration is regenerated at approval.

**Under `team` this reverses.** Drizzle's journal (`drizzle.__drizzle_migrations`) records which
migrations this database has run, so a committed unapplied migration is an ordinary, detectable
state rather than drift. There the committed migration _is_ the record, drizzle's own per-migration
hash is the fingerprint, and Glaze's own change hash is redundant. Approval does not regenerate
anything, which is also what makes a rename approvable at all: the developer's answer to "is this a
rename?" is in the committed SQL instead of being re-derived, differently, by a machine with nobody
at it.

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

**The change hash** identifies a change under `solo`, where nothing else does. It covers the ordered
migration statements, NUL-separated, plus the parent snapshot id. NUL rather than a printable
separator for the same reason the differ uses it: a space-joined key collides on identifiers that
contain spaces, and that collision fails open. Under `team` the fingerprint is drizzle's own
per-migration hash of the committed file, and this one is not used.

**The findings do not hash.** "1,204 rows hold data" is a live count that legitimately moves between
request and approval. So at approve time the layer-1 probes re-run and the result must match what was
shown — same findings, same counts. Any difference refuses the approval and re-renders with the new
numbers. Somebody who approved "this drops 12 rows" did not approve "this drops 40,000", and treating
those as one decision is the silent error the oracle exists to prevent.

## At boot

1. Work out what the change is — diff against the snapshot (`solo`), or read the unapplied committed
   migrations from the journal (`team`).
2. **Nothing to do** — reconcile any open request (below).
3. **Safe** — apply it, if this machine applies at all (`autoApply`).
4. **Blocking** — fail closed with an actionable error. Audited or not.
5. **Destructive** — probe the live row counts, record `requested`, and hold. Answer it now if
   somebody is here; otherwise leave it pending. Boot continues either way.

Boot **does not fail** on a pending approval. The server starts, the admin is reachable — it is where
the approval happens — and the content API serves what the database actually has.

### Reconciling a request that resolved itself

"Nothing to do" plus an open request has two possible causes, and they are opposites. The schema was
reverted, or the change was applied by somebody with a console. Recording `withdrawn` for the second
is the worst failure an audit trail has: it asserts a retraction of a change that in fact destroyed
1,204 rows, and someone will believe it.

Glaze must therefore work out which happened rather than assume:

- **`team`** — read the journal. If the migration is there, it ran. This is a fact, not an inference.
  Record `applied`, noting that it happened outside Glaze.
- **`solo`** — probe for the change the request describes. Its target gone means it was applied; its
  target still present means the schema was reverted, which is the only case `withdrawn` is true for.
- **Partially applied** — real drift, and dangerous. Fail closed rather than pick a story.

A developer with a console will always be able to run migrations by hand, and a CMS that fights its
own developers loses. The answer is to reconcile, and to give that developer a sanctioned path (see
below) so the trail stays accurate because the tool they reached for knows about it.

## The content API while a change is pending

Only destructive changes are held, which removes almost all of this problem. An earlier draft held
additive changes too, so the schema file advertised a column the database did not have and every read
of that entity failed. That cannot happen now: an added column is applied before anything serves it.

What remains is a column pending a **drop**. The database still has it and it is still served, which
is correct and needs no filtering — the change has not happened yet. The descriptor marks it
`pending: drop` so the admin can show it as on its way out.

## Two ways to answer

The admin screen is not _the_ way to approve. It is how a person without a terminal approves. A
developer gets a command, and both write the same record.

### The screen

One authenticated route. Shows the open request — what it does in words, the statements, the affected
tables, and the pre-flight findings with their row counts — and offers **approve** and **reject**, the
latter requiring a reason. Both locales; `es.ts` is typed as `Translations`, so drift is a compile
error rather than a TODO.

```
GET  {apiPrefix}/pending-approvals              # open requests, derived from the events
POST {apiPrefix}/pending-approvals/:id/approve  # verify, re-probe, apply
POST {apiPrefix}/pending-approvals/:id/reject   # { reason }
```

Approval **applies in-process, in the handler** — verify the change still matches, re-probe the live
counts, apply through the oracle. That is the payoff of the injected `resolve`/`confirmLoss`/
`confirmDrop` seams: the real UI becomes just another caller. It holds the request open for seconds;
if that becomes a problem the answer is a job with status polling, but not before the problem is felt.

### The command

`glaze migrate` applies the change **and** closes the request as approved by whoever ran it, in one
step. Without it, a developer who is impatient with a screen built for non-technical people will
apply the migration by hand, and the trail will be left to infer what happened after the fact. With
it, the fast path and the honest record are the same path.

This also covers the deploy step of a `team` project, where `autoApply` is off and applying is a
deliberate act by a person who is shown the counts at the moment they matter.

## Notification

The requester is told when their change is approved or rejected, behind **one internal call**. This
slice implements it by **polling** — the screen refetches. The WebSocket is the next increment and
swaps in behind that call without touching approve/reject. AGENTS.md §11 takes real-time off the
critical path deliberately.

## Recorded reversals

Written down because each is the kind of decision that gets silently re-reverted.

1. **Approval happens in the admin UI, not only the CLI.** Both prior implementations put it in the
   CLI — `glaze-cms-old`'s flows #3 and #6 both end "Dev applies via CLI", with the admin UI limited
   to `GET /schema/pending` for visibility. AGENTS.md §1 requires that a non-technical person can
   approve a schema change without touching migrations, which overrides that. The CLI is a
   first-class second path, not an escape hatch.
2. **The pending record is not the generated migration — under `solo`.** Supersedes
   `convergence.md`'s "Pending = a generated-but-unapplied migration". Under `team`, where the
   journal tracks what has been applied, it is.
3. **`audit` is config, not derived from `mode`.** `glaze-cms-old` had `{ mode, audit }` as
   independent settings; this repo fused them into a derived `gate`. Restored, under the old name.
4. **A change is held for what it does, not for a flag.** An earlier draft of this document held every
   structural change when `audit` was on. That is more ceremony than the promise needs, less
   protection than it implies, and it created the content-API problem that section used to solve.
5. **`mode` is behavioural after all.** The matrix here previously said it "only decides whether the
   migration file is kept". Keeping the files is what makes a machine apply a chain rather than
   re-derive a diff, which is the largest behavioural split in the system.
6. **A deployed server does not generate.** Re-deriving the change on a machine with nobody at it
   makes the change depend on who booted: the same schema file yields a rename on a developer's
   terminal and a drop-plus-create on a server, because the non-interactive answer to
   `rename_or_create` is "create". Found by adversarial review, reproduced on both dialects.

## Out of scope

- **The `ui` origin.** `converge()` is whole-schema from a schema file; there is no granular "someone
  clicked rename" entry point. An admin-originated change additionally has to reach the developer's
  Drizzle file, or the next boot from that repository proposes to undo it. That write-back is the one
  thing a mixed team genuinely needs a developer for, and it deserves its own design pass. A no-dev
  deployment does not hit it, because nobody is booting from a repository to contradict them.
- **The WebSocket** — next increment.
- **Queueing** — arrives with the `ui` origin.

## Still to build

- **Holding only what destroys data.** The code committed so far holds _every_ structural change when
  `audit` is on — the earlier model. It already refuses blocking changes correctly; what it does not
  yet do is let a safe change through. This is the smallest of the corrections and the one that makes
  the content-API problem disappear.
- **The `team` apply path.** `drizzle-orm/postgres-js/migrator` and `drizzle-orm/bun-sqlite/migrator`
  read the committed chain, compare it to the journal, and apply what is missing. Glaze must apply
  the statements **itself** rather than delegating: drizzle's migrator owns its own transaction, and
  the layer-2 oracle has to be able to roll back on a row loss nobody declared. That means Glaze also
  writes the journal row, which is a compatibility promise — the hash is a sha256 of the whole
  `migration.sql` text — so that someone running `drizzle-kit migrate` does not re-apply everything.
- **`autoApply`**, and the `.glaze/` cache that makes `solo` actually keep no files.
- **`glaze migrate`.**
- **A third internal namespace.** Drizzle's journal claims a `drizzle` Postgres schema alongside
  `glaze` and `glaze_auth`. The oracle's idea of which tables hold user data must know that;
  `isMetaTable` currently matches `__drizzle_migrations` by bare name only.

## Open

- **Approving a batch, or one migration at a time?** The journal is per migration, so three unapplied
  migrations are three decisions. One at a time matches the trail and is safer; a batch matches how a
  deploy thinks. Leaning one at a time, applied in order.
- **Should self-approval eventually be disallowed?** Permitted here and recorded as such. Strict
  second-party would let Glaze claim "no structural change reaches production without a second pair of
  eyes" — an enumerable guarantee of the kind AGENTS.md §3 asks for — but it deadlocks a two-person
  team, and it would break a team of only editors and non-technical admins entirely.
- **Where the RBAC placeholder goes when the real policy model lands** — the `principal` table is
  shaped to be replaced, not extended.
