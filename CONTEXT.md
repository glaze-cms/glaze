# Glaze CMS

The words this project uses, and the ones it has stopped using. One term per concept: when two
words compete, the loser is listed under _Avoid_ so it does not creep back through a doc, a comment,
or a column name.

This is a glossary, not a spec. Behaviour lives in [`AGENTS.md`](./AGENTS.md) and `specs/`.

## Convergence

**Convergence**:
Bringing the live database into agreement with the schema the developer declared. One pipeline, run
at boot.
_Avoid_: sync, migration run

**Snapshot**:
The recorded description of the database's structure as of the last convergence. It is the authority
on structure — not the live database, and not the schema file.

**Drift**:
The gap between what a schema file declares and what the database actually holds.

**Envelope**:
drizzle-kit's structured description of a diff. Glaze decodes it instead of parsing command output.

**Target**:
What one decision is about, as drizzle names it: a table, a column, an index, and its path
(`public.users.handle`). Not an entity — this is a database object, not a thing an editor manages.

**Decision**:
A question a diff cannot answer on its own — is this a rename or a create, may this data be
destroyed. Always answered by a person, never guessed.

**Seam**:
A spot where Glaze takes a function instead of doing the job itself — where a person answers a
question, or where Bun and Node need different code. It is what lets the whole pipeline run in a
test with no person and no browser.

**Oracle**:
A check that goes and looks, instead of believing what it was told. The data-loss oracle counts the
rows itself, before and after, rather than trusting the tool that ran the migration to report
honestly.

## Workflow

**Migrations** (`{ enabled, path }`):
Whether a file is kept for every schema change, and where. Keeping them is what lets a deployed
machine apply a chain instead of working the change out again for itself.
_Avoid_: solo, team, mode, persist — those named a team size and meant a file format.

**Audit** (`true` / `false`):
Where a pending change is answered: on the admin screen, or at the terminal. It does not decide
whether a change is pending — one that destroys data always is.
_Avoid_: gate — in this repo "the gate" is oxlint + oxfmt + TS7 + matrix, and nothing else. held,
hold — a change is pending, or it applies.

**autoApply** (`true` / `false`):
Whether this machine applies migrations when it starts. On for a developer, off for production, so a
deploy applies when somebody decides to, not because a process restarted.

**Classifier**:
The step that reads the difference between two snapshots and has something to say about every
operation in it: additive, destructive, or unclassified. Runs once, before anything is applied.
_Avoid_: differ, detector — the first is drizzle's job, the second measures rather than sorts.

**Additive**:
A change that destroys nothing by construction — a new table, a nullable column, a wider type, an
index. It applies without asking anybody, audited or not.

**Destructive**:
A change that removes or rewrites stored values in shape — dropping a column or a table, narrowing a
type. Measured against the live database first: dropping an empty column destroys nothing and stops
nobody; dropping one holding 1,204 values is pending until a person agrees. Distinct from
**impossible**: a change the database refuses outright (`NOT NULL` over nulls), which nobody can agree
to. Neither means risky in general — an `ALTER` that locks a large table for four minutes is neither.
_Avoid_: confirmable, blocking — those name the code that handles them, not the change.

**Unclassified**:
A change the classifier has no rule for. It is pending — or asked about at the terminal — and
reported as unknown, not as dangerous. It is an admission: a gap in the classifier costs an approval,
never data. Somebody teaches the classifier and the annoyance goes away.
_Avoid_: unknown change, unsupported — the change is supported; it is not yet understood.

**Journal**:
Drizzle's record of which migrations this database has already run (`drizzle.__drizzle_migrations`).
It is what makes a committed, unapplied migration an ordinary state rather than drift.

**Origin** (`dev` / `ui`):
Where a change came from: a developer's schema file, or a click in the admin.
_Avoid_: admin (for the origin), source, trigger

## Approvals

**Pending approval**:
A structural change that has been detected, described, and recorded, and that will not apply until a
person decides on it.
_Avoid_: ledger, pending migration, pending request

**Approval request**:
One change awaiting a decision. Identified by a `requestId` that groups every event about it.
_Avoid_: request on its own, which means an HTTP request everywhere else

**Approval event**:
One recorded thing that happened to a request — requested, approved, rejected, applied, superseded.
Append-only; current state is derived from the events, never stored beside them.

**Change hash**:
The fingerprint of a detected change. Two changes with the same hash are the same change; a
different hash means the schema moved and the open request is stale.

**Superseded** / **Withdrawn**:
The schema moved while a request was open, so the request no longer describes reality: superseded
when it changed into something else, withdrawn when it was reverted.

## Identity

**Principal**:
Someone who can sign in and be given permissions: a person with an account. An agent is not one of
its own — it acts as the person who runs it. A principal is on the list whether or not it is doing
anything right now, the way a name stays on a staff list overnight.

**Actor**:
Whoever did one particular thing. Usually a principal; `system` when Glaze did it itself, which is
why an event can have no actor at all.

**Kind** (`user` / `system`):
What sort of thing acted: a person, or Glaze itself. There is no `agent` kind — an agent acts as the
person who runs it, and what it does is recorded under that person's id. It says nothing about what
they may do.

**Role** (`admin` / `editor` / `user`):
What a principal is allowed to do — approve a schema change, edit content. It is written down on the
principal, never guessed from how they signed in. `user` is the floor: every account stands on it the
moment it exists, and it is never stored — a principal row is a grant of something more.

**Claim** (the first admin):
How a fresh Glaze gets its first admin. A signed-in account asks for it, and gets it only while no
admin exists; afterwards the path is **sealed** and refuses everybody, the admin included. It is the
one grant that has no admin to make it.
_Avoid_: bootstrap, setup user, create-first-user

## Content

**Entity**:
One kind of thing an editor manages — posts, authors, site settings. The noun the admin is organised
around.
_Avoid_: collection, content type, model, resource

**Field**:
The box an editor sees and fills in. The **column** is where that value is stored in the database.
Keeping them separate is deliberate: you can rename a field, reorder it or change its help text
without touching the database at all.

**Structure**:
What the database itself enforces — the column exists, holds text, cannot be empty. The snapshot is
where it is recorded, and changing it is the slow path: a migration, and possibly someone's
approval.

**Presentation**:
What an editor sees — labels, order, help text, which widget. Stored in the database, applies
immediately, risks no data.

**View state**:
One person's view of a screen — sort, visible columns, density. Never leaves their browser.
