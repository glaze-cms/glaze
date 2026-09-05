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
Where a held change is answered: on the admin screen, or at the terminal. It does not decide whether
a change is held — one that destroys data always is.
_Avoid_: gate — in this repo "the gate" is oxlint + oxfmt + TS7 + matrix, and nothing else.

**autoApply** (`true` / `false`):
Whether this machine applies migrations when it starts. On for a developer, off for production, so a
deploy applies when somebody decides to, not because a process restarted.

**Destructive**:
A change the database will make without complaint, that destroys data on the way — dropping a column
holding values. The only question it raises is whether you want it. Distinct from **impossible**: a
change the database refuses outright, which nobody can agree to. Neither means risky in general — an
`ALTER` that locks a large table for four minutes is neither.
_Avoid_: confirmable, blocking — those name the code that handles them, not the change.

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
Someone or something that can sign in and be given permissions: a person with an account, an agent,
an API token. A principal is on the list whether or not it is doing anything right now, the way a
name stays on a staff list overnight.

**Actor**:
Whoever did one particular thing. Glaze itself does things too (it closes a request when someone
reverts the schema), and Glaze is not on the list, so an actor is not always a principal.
Every principal can be an actor; not every actor is a principal.
_Avoid_: swapping the two words. A principal is a name on the list; an actor is a name in a sentence
about something that happened. There is no actor table — only the list of principals, and events
pointing into it.

**Kind** (`user` / `agent` / `system`):
What sort of thing a principal is: a person, something running on its own, or Glaze itself. It says
nothing about what they may do.

**Role** (`admin` / `editor`):
What a principal is allowed to do — approve a schema change, edit content. It is written down on the
principal, never guessed from how they signed in, and never from their kind: an agent that may edit
is not an agent that may approve.

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
