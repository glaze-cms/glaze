# Pending approvals — design of record

> Settled 2026-09-05, amended 2026-09-05 after the first implementation pass and two adversarial
> reviews. The amendment is not cosmetic: a change is now pending for **what it does** rather than for
> a boolean, a deployed server **applies** the committed chain instead of re-deriving it, and a
> developer answers at a terminal rather than waiting for a screen built for someone else. What each
> correction supersedes is recorded under [Recorded reversals](#recorded-reversals).

## The principle

**A change that cannot be applied without a decision is made pending, recorded, and shown to a person before
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

| Setting              | Values                      | Decides                                                            |
| -------------------- | --------------------------- | ------------------------------------------------------------------ |
| `migrations.enabled` | `true` / `false`            | is a file kept for every schema change                             |
| `audit`              | `false` / `true`            | a pending change is answered at a terminal, or on the admin screen |
| `autoApply`          | `false` / `true`            | does this machine apply anything at boot                           |
| role                 | `admin` / `editor` / `user` | who may approve                                                    |

**Keeping the files is behavioural.** It is not a filing preference: a committed chain is a thing a
machine _applies_. With `enabled: false`, every machine diffs the schema against the database and
applies directly — a deployed server does what the laptop does. With `enabled: true`, the developer
generates and commits, and every other machine runs the committed chain, with drizzle's own journal
recording which migrations this database has already run.

The setting says nothing about how many people you are. A developer working alone who wants a history
of every change writes `migrations: { enabled: true }` and is done; the old `solo`/`team` pair made
that person declare a team to get a file format.

**`audit` does not decide whether a dangerous change is pending.** It always is. A safety promise
with an off switch is not a promise. `audit` decides where the answer comes from: `false` asks at the
terminal and fails closed when there is no terminal; `true` files a pending approval and lets a
person answer on a screen.

Defaults: `audit` is `false` — you are at a terminal, so answer there. A project that deploys sets it
`true` so the question reaches a screen instead. `autoApply` follows the old `autoRun`: on for a
developer, off for production.

## What is pending, and what is not

**A change that destroys data is pending. Everything else applies.**

This is the mechanism finally matching the principle. Earlier drafts of this document made _every_
structural change pending behind a boolean, which is both more ceremony than the promise needs and less
protection than it implies. Adding a column is not dangerous and buys nothing by waiting. Dropping a
populated one is the entire reason this feature exists.

### The classifier must account for every operation

**A classifier reads the snapshot diff and must have something to say about every operation in it. An
operation it does not model is pending.**

This is the load-bearing sentence, and getting it wrong is what makes the feature unsafe. A first
attempt keyed "destructive" off the layer-1 findings alone, so a diff producing no findings read as
"this destroys nothing" — when what it means is "layer-1 had nothing to say about this". Collapsing
those two applied a populated table drop, a rename-plus-column-drop, and a `numeric(10,4)` →
`numeric(10,2)` narrowing without holding any of them. Proven on both dialects during review, each
one silent.

So the classifier returns three buckets, not a list of findings:

- **Additive** — provably destroys nothing: add a table, add a nullable column, widen a type, add an
  index. Applies.
- **Destructive in shape** — removes or rewrites stored values: drop a column, drop a table, narrow
  or coerce a type. Then probe the live database, because dropping an _empty_ column destroys nothing
  and should stop nobody. Pending only when the target actually holds values.
- **Unclassified** — the differ has no model for this operation. **Pending**, and reported as
  unclassified rather than as a data-loss finding, because it is not one. It is an admission.

The third bucket is the point. It inverts what a gap in the differ costs: today a gap costs data,
silently; under this rule it costs an unnecessary approval. Glaze becomes annoying where it is
ignorant and never unsafe — and the annoyance is self-correcting, because somebody goes and teaches
the differ.

The cost is real and worth stating plainly: on a first version that kind catches a great deal.
Additive has to be seeded with the operations we already understand, or an audited project is
unusable on contact.

**What the classifier reads.** drizzle-kit exposes no typed list of operations — `generate` writes a
migration and a snapshot, nothing else — and the SQL is the wrong input: on SQLite a `NOT NULL` add is
emitted as a whole table rebuild with a `DROP TABLE` in the middle of it. So the classifier diffs the
two snapshots' `ddl` arrays by entity identity (type, schema, table, name), after first rewriting the
parent with the renames the resolver answered so a rename reads as a rename. Measurements name what the
database has **now**: a column under a table being renamed is counted under the table's old name,
because the rename has not happened yet. Every measurement is schema-qualified on Postgres, so a
populated `shop.orders` is never mistaken for an empty `public.orders`. (The row-count oracle that
verifies the apply still counts `public` only — a table outside it is decided here and not
re-verified there.)

**The rules, first version** (`convergence/classifier/classifier.ts`). Anything not in this table is
unclassified.

| entity                          | added                                                                                                                                                                                                                                                              | dropped                                                        | changed                                                                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| anything under a new table      | additive                                                                                                                                                                                                                                                           | —                                                              | —                                                                                                                                                                                                                                    |
| anything under a dropped table  | —                                                                                                                                                                                                                                                                  | covered by the table drop                                      | —                                                                                                                                                                                                                                    |
| table                           | additive                                                                                                                                                                                                                                                           | destructive (`table_has_rows`)                                 | unclassified                                                                                                                                                                                                                         |
| column                          | additive; required without a default → destructive (`not_null_column_non_empty`), unless the database fills it (identity, serial); required and generated → unclassified                                                                                           | destructive (`column_has_data`); a generated column → additive | `NOT NULL` gained → destructive; lost → additive; default → additive; string type widened → additive, narrowed → destructive (`column_length_overflow`); on an array column → unclassified; **any other type change → unclassified** |
| index                           | additive; unique over one existing column → destructive (`unique_duplicates`); over an expression, several columns, or with a `where` → unclassified; over columns created in the same change → additive when they arrive without a default, unclassified with one | additive                                                       | as added                                                                                                                                                                                                                             |
| unique constraint               | over one existing column → destructive (`unique_duplicates`); over several → unclassified; over columns created in the same change → additive when they arrive without a default, unclassified with one                                                            | additive                                                       | unclassified                                                                                                                                                                                                                         |
| foreign key, check, primary key | unclassified (the database may refuse it; nothing measures that yet)                                                                                                                                                                                               | additive                                                       | unclassified                                                                                                                                                                                                                         |
| enum, schema, view              | additive                                                                                                                                                                                                                                                           | unclassified                                                   | unclassified                                                                                                                                                                                                                         |

The shapes the database may refuse (`NOT NULL` over nulls, a unique over duplicates) sit in destructive
because the same measurement answers them; afterwards the finding code tells a real decision (a
populated drop, which a person may agree to) from an impossible change (which fails closed).

Where the differ will next need teaching, in the order people will hit it: a foreign key or check added
to an existing table (measure for violating rows); an integer or numeric widening (additive, provably);
an enum gaining a value (additive); a column rename under a check, a partial index or a generated
column, which drizzle re-renders in the expression text so the rename reads as a change to the
expression (pending today, a rename in truth). Each is a row in the table and a test, not a design.

Two things drizzle-kit rc.4 does that the classifier cannot undo, recorded so nobody hunts for them
in Glaze: dropping a column together with a generated column that depends on it is emitted
source-first, so the approve can never apply (both databases refuse; the apply rolls back, data
intact); and a required generated column on Postgres is emitted without its `NOT NULL`, so the
database and the snapshot disagree from then on. Both are in `specs/research/drizzle-kit-rc-1.0-sdk.md`.

### Impossible is separate, and fails closed

`NOT NULL` on a column holding nulls, a unique index over duplicates, a probe that could not answer.
The database refuses these outright, so there is nothing to say yes to and nobody to say it: they fail
closed at boot, audited or not. Filing one as a pending approval would put an approve button on a
change that can never succeed.

Narrowing a string column over longer values is **not** in this class, though it looks like it should
be: drizzle emits the change with an explicit cast (`USING "c"::varchar(10)`), and Postgres truncates
under a cast rather than refusing. It destroys data and succeeds, so it is a decision like a drop.

### Layer-2 does not decide

The two oracles used to divide the work and say so. Layer-1 owned column-level, count-preserving
loss and delegated whole-table drops to layer-2 — "a whole-table drop is the oracle's job", the old
pre-flight said. Layer-2 states in its own documentation that it does **not** see count-preserving
corruption: a column drop, a precision truncation, a SQLite rebuild landing values in the wrong
columns.

That division is right for verification and fatal for deciding. Layer-2 runs _around the apply_, so a
decision resting on it cannot hold anything — which is exactly how a populated table drop escaped: it
reached `confirmLoss` during the apply, where `audit` has no say.

So deciding happens **once, before anything runs**, over the whole diff. Layer-2 returns to what its
own documentation describes: an independent check that the apply did what was predicted.

An unreadable parent snapshot is unclassified, not an empty string. Failing to read the thing a change
is relative to is not a weaker fingerprint — it is not knowing what the change is.

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
Those are safe by this definition and can still take a site down. Pending protects data, not uptime,
and should not be described as catching dangerous changes in general.

### The second trigger: a change nobody reviewed

A `dev`-origin change has already been read by a person — it went through a pull request before it
could reach a schema file. A `ui`-origin change has not: someone clicked a button and the schema
moved. That is not dangerous because it destroys data; it is unreviewed.

So a `ui` change is also pending — **but only when the person who made it cannot approve it.** This is
the difference between a team with developers and a team without, and it is a permission, not a
workflow setting: give editors `propose` and withhold `approve`, and their changes queue for someone
who has it. AGENTS.md §1 already commits to this ("an actor granted `propose` and never `approve`
cannot write to production **by policy**").

**A team of only editors and non-technical admins must be able to work.** They are who the thesis is
for. Their admin holds `approve` — the first account to sign up becomes `admin` — so their safe
changes apply immediately and their destructive ones are pending, shown, and approved by them. That
self-approval is not ceremony: the value was never a second signature, it is being shown the row
counts before agreeing, and one person can be shown a number.

### Permission answers "may you approve", never "may you skip"

Pending applies uniformly across origins and actors. There is no bypass — not for an admin, not for
the person who made the change. What is not permitted is a destructive change that applies without
ever having been recorded.

**Distinct from this:** drizzle's own decisions (`rename_or_create`, `confirm_data_loss`) still
resolve **synchronously**, as `convergence.md` requires — they must be answered before a migration
can be generated at all. Pending then applies to the generated result. Two different moments.

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

**Pending is a state, not a route.** A record is written for every pending change; "pending" is only
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

This holds **when nothing tracks what has been applied**, which is the no-files case and was the only
one earlier drafts considered.

Keeping a generated-but-unapplied migration on disk advances the snapshot past the database. The next
boot then diffs the schema against a snapshot that already contains the change, reports `no_changes`,
and the drift goes invisible — fail-open, and in the direction that hides exactly what this feature
exists to show. So without files the change is generated to learn what it does, discarded, and its
statements plus a fingerprint recorded; the migration is regenerated at approval.

**With files kept this reverses.** Drizzle's journal (`drizzle.__drizzle_migrations`) records which
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
| `actorKind`  | `user` / `system`. No `agent`: an agent acts **as** a user, so nothing can write one.            |
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

`userId` (the Better Auth user id) and `role`. Approving requires `admin`.

**Signing up grants no privilege.** A self-registered account gets `user` — the least-privileged
role — and stays there until an admin grants more. Today a `user` can do what any signed-in account
can: the content API is gated on a session, not on a role, until RBAC says otherwise. What a `user`
cannot do is approve a schema change or become admin, and that is the whole of the fix for the hole
described below: winning a race to sign up no longer buys either.

`user` is not a row. A row in `principals` is a grant of something above the floor, and an account
with no row is a `user` by definition. So nothing runs at sign-up: no hook that can throw after Better
Auth has already committed the account, no orphaned account with a half-assigned role, and no way for
sign-up volume to touch a Glaze table. A row whose value the code does not recognise also reads as
`user` — an unknown value in the role column is answered with the least privilege, never a guess.

**The first admin is created once, through a sealed path.** Both Payload and Strapi do this: Payload
redirects every visitor to `/create-first-user` while the users collection is empty and returns
`Forbidden` from that route once it is not; Strapi's first-launch log sends you to the panel to make
the first admin. Glaze follows the convention. What Glaze must _not_ copy from its own earlier
attempt is granting a real role to everybody who signs up afterwards — neither of them does that, and
it is what turned an ordinary race into privilege escalation.

Glaze's sealed path is a **claim**, not a form that creates the account. A person signs up like
anybody else and, while signed in, asks `POST {api}/setup/first-admin`; the answer is `admin` if no
admin exists yet, and `403` for everybody — the admin included — from the moment one does. The seal is
"an admin exists", not "you are not the admin". It is the one grant that has no admin to make it, so
the empty table stands in for one, and it has the same shape every later grant will have:
authentication is the person's, authorization is the admin's. Creating the account inside the same
call was considered and not chosen: it would mean forwarding Better Auth's cookies past Elysia, mapping
its thrown errors into the envelope, and a failure between creating the account and granting the role
would leave a taken email with nothing to show for it. `GET {api}/setup` reports whether a first
admin is still needed, which is what the setup screen will read — Payload's redirect reveals the same.

**"First" is held, not hoped for.** The read and the write share one `queryTransaction`, and claims
take turns: on Postgres the transaction takes `pg_advisory_xact_lock` first, so a second claimant
waits for the first to commit and then reads the admin it wrote; on SQLite the seam runs transactions
one at a time on its single connection, which is the same guarantee. Eight claims arriving together
grant one admin, on both dialects, and the test that says so fails without the lock.

The claim reads the session **table**, not the signed session-data cookie the rest of the API accepts
for a few minutes after sign-out. Reading content on a just-revoked session is tolerable; making an
admin on one is not.

An account that already holds a lesser grant (an editor, once something can make one) is raised to
`admin` by the claim rather than refused — the seal is about admins existing, not about the claimant
being new. Two consequences of keying the seal on "an admin row exists", written down so they do not
look accidental: demoting or deleting the only admin's row reopens the claim to whoever is signed in
(nothing does either today); and deleting the only admin's **account** while the row stays leaves
the seal shut with nobody able to act, since `principals` has no foreign key to the auth tables. The
recovery for the second is to remove that row by hand; RBAC, which will have an admin-facing way to
grant and revoke, is where a better answer belongs.

Neither competitor bothers with a setup token, and neither does Glaze by default. It is an opt-in for
people deploying publicly before configuring (`GLAZE_SETUP_TOKEN`; when set, the claim must carry it
in `x-glaze-setup-token`, compared in constant time; a random value, not a phrase, because the route
is not rate-limited). The seal is checked before the token, so once an admin exists the token cannot
be probed through this route.

Roles are not promoted through sign-up, and accounts are not created _for_ people: an administrator
who creates an account has to set somebody else's password. Instead, **authentication is theirs and
authorization is the admin's** — a person makes their own account, and an admin decides what it may
do. That needs no invitation system and no mail server, neither of which Glaze has.

Deliberately **not** a column on the Better Auth user table, though `glaze-cms-old/docs/rbac.md`
recommended that for request-path performance. The reason is the one that matters most about roles:
**the sign-up endpoint must not be able to say "I am admin".** A table Better Auth knows nothing
about has no field to express a role, so the rule is structural rather than a check somebody has to
remember to write. The auth schema also states — with a shape-guard test behind it — that it carries
no RBAC field on purpose.

An earlier version of this paragraph justified the separate table with "an agent will never be a
Better Auth user". That no longer holds: an agent acts **as** a user, and you are responsible for
what your agent does. The table is still right, for the reason above.

RBAC **builds on this table rather than replacing it** — `approval_events.actorId` points at a
principal and the trail is append-only, so it cannot be swapped out underneath. What gets replaced is
the `role` column, which cannot express permissions scoped to a resource or `propose` held apart from
`approve`.

**A deliberate divergence, recorded so it does not look accidental.** Payload keeps roles as a field
on the users collection and protects them with field-level access rules, including an explicit
`preventSelfRoleChange`. Glaze keeps them in a table the auth library cannot see, so there is no field
to protect. Theirs is a rule that has to be written correctly every time; ours holds by construction.
Both work; this is the one we chose.

### Why the trail has no foreign key

Neither table references the auth tables, and that is a decision rather than an omission. **An event
must outlive the account that caused it.** With a foreign key, deleting a user either cascades and
destroys the audit trail, or blocks and makes it impossible to offboard anybody — and the events of a
departed account are exactly the ones an audit is for. Without one, the trail still says who dropped
the column long after they have gone.

This is also what `actorId` being nullable buys. Glaze reconciles requests itself — `superseded` when
the schema moves, `withdrawn` when it is reverted — and those events have no person behind them. The
alternative is inventing a robot account, and then "who approved changes last quarter" counts a
process as a colleague.

## Integrity

**The change hash** identifies a change when no file does. It covers the ordered
migration statements, NUL-separated, plus the parent snapshot id. NUL rather than a printable
separator for the same reason the differ uses it: a space-joined key collides on identifiers that
contain spaces, and that collision fails open. With files kept, the fingerprint is drizzle's own
per-migration hash of the committed file, and this one is not used.

**The findings do not hash.** "1,204 rows hold data" is a live count that legitimately moves between
request and approval. So at approve time the layer-1 probes re-run and the result must match what was
shown — same findings, same counts. Any difference refuses the approval and re-renders with the new
numbers. Somebody who approved "this drops 12 rows" did not approve "this drops 40,000", and treating
those as one decision is the silent error the oracle exists to prevent.

## At boot

1. Work out what the change is — diff against the snapshot, or read the unapplied committed
   migrations from the journal when files are kept.
2. **Nothing to do** — reconcile any open request (below).
3. **Safe** — apply it, if this machine applies at all (`autoApply`).
4. **Blocking** — fail closed with an actionable error. Audited or not.
5. **Destructive** — measure the live row counts, record `requested`, and wait. Answer it now if
   somebody is here; otherwise leave it pending. Boot continues either way.

Boot **does not fail** on a pending approval. The server starts, the admin is reachable — it is where
the approval happens — and the content API serves what the database actually has.

### Reconciling a request that resolved itself

"Nothing to do" plus an open request has two possible causes, and they are opposites. The schema was
reverted, or the change was applied by somebody with a console. Recording `withdrawn` for the second
is the worst failure an audit trail has: it asserts a retraction of a change that in fact destroyed
1,204 rows, and someone will believe it.

Glaze must therefore work out which happened rather than assume:

- **Files kept** — read the journal. If the migration is there, it ran. A fact, not an inference.
  Record `applied`, noting that it happened outside Glaze.
- **No files** — probe for the change the request describes. Its target gone means it was applied; its
  target still present means the schema was reverted, which is the only case `withdrawn` is true for.
- **Partially applied** — real drift, and dangerous. Fail closed rather than pick a story.

**The chain is evidence; the database is the witness.** Both `migrations.enabled` modes keep the
migration directories (the no-files cache is still to build), and `converge()` sweeps a directory on
anything but a commit, so a directory in `out` says a migration was generated and committed. It does
not say it ran _here_: `out` is committed to the repository, so a directory can come from a
colleague's database (this section's own rule — an approval belongs to one database — is exactly why
that matters), or be left behind by a process killed mid-boot. So before the trail says `applied`,
boot looks in the live database for what the request would change: the column or table it drops,
the length of a column it narrows. Present means the change is not in effect, whatever the chain
says. Gone means it is — but only when nothing on the way could have merely _moved_ the data: a
missing table says nothing about its columns, and a rename anywhere between the request and now
makes "absent" unreadable, so both are `undetermined` rather than `gone`. A request with an
operation nothing can look for (unclassified) is never `gone` either.

The witness is read **twice**: before this boot converges, to answer for what others did since the
request was filed, and after, to answer for what this boot did. Each request records the snapshot
it was measured against (`parentSnapshotId`) and its findings; boot reads the answer off three facts
in order (`server/convergence/reconcile.ts`):

1. **What was generated since the request was filed.** Walk the chain from the head it had _before_
   this boot back to the request's snapshot. The request's hash on the way and its targets gone
   before this boot → `applied`, naming the migration, `outsideApproval`, `verified`. Hash found but a
   target still there → **left open**, saying which migration claims the change and that either it
   never ran here or the column was added back. The chain advanced without the hash — the same drop
   may still have run inside another migration, against another parent, or from a hand-edited file —
   so the database decides: targets gone before this boot → `applied`, verified; undetermined → left
   open; targets present → this boot's result decides (below). The walk never reaches the request's
   snapshot, the chain has no single head, or the request predates the field → **left open**, logged
   at error level with the reason.
2. **What this boot did**, read from the database _after_ it. The same change `pending` again →
   nothing to record. A different change `pending` → `superseded` by the new request, which is
   filed. The request's own change `applied` — measured again, there was nothing left to decide — →
   `applied`, with the reason. Something else applied and the targets are now gone — the drop went
   along with other changes — → `applied`, with that reason. Something else applied, or nothing to
   do, and the targets are still there → `withdrawn`: the schema no longer carries the change.
   Nothing to do and the targets gone anyway → **left open**: somebody removed them with no
   migration, the database and the snapshot disagree, and neither word is true. A failing boot
   resolves nothing.

Every open request is reconciled, not only the newest, and a new pending change is filed whatever
became of the older ones — a request nobody can reconcile must not hide the ones after it. A
request whose targets cannot be looked for (unclassified only, or a narrowing) is recorded `applied`
with `verified: false` when its exact hash is in the chain, and left open otherwise.

Ctrl+C at the confirmation prompt arrives as the prompt closing, which declines and sweeps the
directory like any other refusal. A process killed outright — `SIGTERM`, a timeout — can leave one,
and that is one of the things the witness is for. What no amount of reading can fix is a directory
that _did_ come from elsewhere: the snapshot is then ahead of this database and every boot finds
nothing to do, until baselining (step 8) can re-anchor it. The trail, at least, does not lie about
it, and the boot log names the directory and says to run its SQL here or remove it.

Writes happen in one transaction that first re-reads which requests are still open, so two instances
booting together do not both close the same request; a pending change already on file under its hash
is not filed twice by the same route. There is no uniqueness constraint behind that, only the
re-read — two instances that both find nothing on file can still each file the same change.

The console case — a column dropped by hand, no migration — does not reach this: the snapshot never
advanced, the schema still carries the drop, and the measurement finds the column gone. Boot fails
closed and says the snapshot has to be re-baselined (step 8). On SQLite that took one more guard:
an unknown double-quoted name is read as a string literal there, so `COUNT("body")` over a table
with no `body` would count the word once per row and report a populated column. A SQLite probe now
checks its column exists first.

A developer with a console will always be able to run migrations by hand, and a CMS that fights its
own developers loses. The answer is to reconcile, and to give that developer a sanctioned path (see
below) so the trail stays accurate because the tool they reached for knows about it.

## The content API while a change is pending

Only destructive changes are pending, which removes almost all of this problem. An earlier draft made
additive changes pending too, so the schema file advertised a column the database did not have and every read
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

This also covers the deploy step of a project that keeps files, where `autoApply` is off and applying is a
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
2. **The pending record is not the generated migration — when no file is kept.** Supersedes
   `convergence.md`'s "Pending = a generated-but-unapplied migration". Where files are kept and the
   journal tracks what has been applied, it is.
3. **`audit` is config, not derived from `mode`.** `glaze-cms-old` had `{ mode, audit }` as
   independent settings; this repo fused them into a derived `gate`. Restored, under the old name.
4. **A change is pending for what it does, not for a flag.** An earlier draft of this document made every
   structural change pending when `audit` was on. That is more ceremony than the promise needs, less
   protection than it implies, and it created the content-API problem that section used to solve.
5. **`solo` / `team` is gone.** It named a team size and meant a file format, so a developer working
   alone had to declare a team to get a history. Replaced by `migrations: { enabled, path }`, which
   says what it does. The old implementation also made the move irreversible; this one goes back and
   forth, because the setting is a preference rather than a project's identity. Turning it **on**
   against a database that already has tables needs a baseline first — the one asymmetry, and drizzle
   supplies most of it (below).
6. **Approve was built before the things it rests on, and reverted.** `f2dd123` added role
   assignment at sign-up and the three endpoints; three parallel reviews found it unsound and it came
   out again (`30bcbe8`, `75f066c`). Three independent causes, all of which the order under
   [Still to build](#still-to-build) now prevents:

   - **The approve handler answered `true` to every question the oracle asked.** That is only safe if
     the verify pass enumerates every question the apply pass will face, and it cannot — layer-2 runs
     only around an apply, which the verify pass never performs. A populated table drop produces no
     layer-1 findings at all, so the recorded findings were `[]`, the comparison was `'' === ''`, and
     the confirmer said yes to destroying the table. The same failure as the classifier attempt,
     through a different door.
   - **`resolve` answered `create` for a rename**, and the fingerprint could not catch it, because an
     unattended boot answers `create` too — so the filing and both passes produced identical
     statements and matched perfectly.
   - **Granting a real role at sign-up turned an ordinary bootstrap race into privilege escalation.**
     Sign-up is open; before that commit, winning the race bought nothing, because no account had a
     role at all.

   The tests held almost none of it: `enrolPrincipal` could have given **every** account `admin`, or
   written an unrelated `user_id`, and the whole suite stayed green.

7. **A deployed server does not generate.** Re-deriving the change on a machine with nobody at it
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

These are a dependency order, not a menu. Approve was built first, before the two things it rests on,
and adversarial review found the same class of failure twice in one day — once at boot, once at the
endpoint. The order below is the lesson.

**1. Transactions that are transactions. — Done (`aef4266`).** `bun:sqlite`'s `Database.transaction`
wraps a **synchronous** function, so `COMMIT` fires at the first `await` and Drizzle's `transaction`
through that driver is a no-op: a throwing transaction leaves its rows behind, and two concurrent
callers see each other's uncommitted state. The dialect seam now offers `queryTransaction`, which runs
a query-builder callback inside the seam's own `BEGIN`/`COMMIT`; the rule for callers is that every
statement goes through the `tx` it hands out, never the outer handle (on Postgres the outer handle
takes a different pooled connection and escapes the transaction). `dialect/transaction.test.ts` proves
a throw leaves nothing behind, on both dialects and both runtimes.

**2. The role bootstrap. — Done.** `user` is the absence of a `principals` row, so sign-up writes
nothing and there is no hook to fail. The first admin is made by a signed-in account **claiming** it
at `POST {api}/setup/first-admin`, allowed only while no admin exists; `GET {api}/setup` says whether
that is still the case. `GLAZE_SETUP_TOKEN`, when set, is required on the claim. See
[`principal`](#principal--the-rbac-placeholder). What is left for the screen: the setup step in
`glaze-admin`, `FORBIDDEN` in its hand-kept copy of `GlazeErrorCode`
(`packages/glaze-admin/src/lib/api/error.ts`), and CORS on `{api}/setup` if the admin is ever served
from another origin — today it is served in-process, same-origin, and the setup routes get none.

**3. The classifier, with its three kinds. — Done.** `classifyChange` accounts for every operation
in the snapshot diff (see the rule table under [What is pending](#what-is-pending-and-what-is-not)).
An additive change now applies under `audit`; a destructive one is measured and pending only when the
measurement finds something; an unclassified one is pending, or asked about at a terminal
(`confirmUnclassified`), and named as unknown rather than dangerous. A populated table drop is decided
before anything runs (`table_has_rows`), and the apply oracle verifies it instead of asking again. The
three cases that escaped the first attempt — a populated table drop, a column drop beside a table
rename, `numeric(10,4) → numeric(10,2)` — are each a test that asserts on the database. Attempted once
before and reverted (`a63653e`), because narrowing to layer-1's findings removed a blanket that was
covering layer-1's blind spots; the unclassified kind is what replaced the blanket.

**4. Boot reconciliation. — Done.** [Reconciling a request that resolved itself](#reconciling-a-request-that-resolved-itself)
now reads the snapshot chain as evidence and the live database as the witness — twice, before and
after this boot — and records `applied`, `superseded` or `withdrawn` from what they agree on, or
leaves the request open and says why. Four reviews made earlier versions lie: a colleague's committed
migration, a directory left by a killed process, a drop that went along with an additive change, a
table renamed with its data kept, this boot's own work credited to somebody else, a hand-dropped
column with the schema reverted. Each is a test now. What remains is a snapshot that ran ahead of
this database through a directory from elsewhere: boot then finds nothing to do, and only baselining
(step 8) can re-anchor it.

**5. `pending: drop` on the descriptor**, so the admin can show a column as on its way out.

**6. The apply path for kept files.** `drizzle-orm/postgres-js/migrator` and `drizzle-orm/bun-sqlite/migrator`
read the committed chain, compare it to the journal, and apply what is missing. Glaze must apply
the statements **itself** rather than delegating: drizzle's migrator owns its own transaction, and
the layer-2 oracle has to be able to roll back on a row loss nobody declared. That means Glaze also
writes the journal row, which is a compatibility promise — the hash is a sha256 of the whole
`migration.sql` text — so that someone running `drizzle-kit migrate` does not re-apply everything.

**7. `autoApply`**, and the `.glaze/` cache that makes `migrations.enabled: false` real. Until it
exists the setting is inert and defaults to `true`, which is what the code actually does.

**8. Baselining, for turning the files on against a database that already has tables.** Drizzle does
the recording: `migrate(db, { migrationsFolder, init: true })` writes the journal row **without
running the SQL**, on both dialects, and refuses if the journal already has rows or if more than one
migration is present. `drizzle-kit pull` is CLI-only and not needed — `pull --init` is for someone
with a database and no schema file, while this case is the opposite: the schema file already matches
the database, which is why there is nothing to apply.

The step drizzle cannot do is the one that matters: **verify the database really does match** before
recording anything. Our own introspection answers that, and it must fail closed on a mismatch —
baselining a database that does not match marks real work as already done, silently, in the
direction that loses data later.

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
