# Content modelling

> Read `./convergence.md` first; this document extends its source-of-truth model to the content layer.

## The principle

**Three layers, three sources of truth. Which layer a change belongs to determines where it is
written and what ceremony it earns.**

| Layer            | Example                                                                | Source of truth                           | Ceremony                        |
| ---------------- | ---------------------------------------------------------------------- | ----------------------------------------- | ------------------------------- |
| **Structure**    | column exists · is `TEXT` · `NOT NULL` · FK to `authors`               | the **snapshot** (see `./convergence.md`) | migration + approval            |
| **Presentation** | label `"Article body"` · field order · hidden-in-form · select options | the **DB** (`glaze` namespace)            | none — applies immediately      |
| **View state**   | sort column · visible columns · density · page size                    | the **client** (`localStorage`)           | none — never leaves the browser |

Mis-filing a change is the failure mode this document exists to prevent. Routing a label rename
through migration generation, an approval queue and a redeploy is as wrong as letting a column drop
apply without the data-loss oracle.

### The test

When it is unclear which layer something belongs to, ask:

> **Does the public content API need it to render the site correctly?**
> Yes → **structure**. Only affects how the admin's editing UI looks → **presentation**.

| Thing                               | Test                                           | Layer         |
| ----------------------------------- | ---------------------------------------------- | ------------- |
| `page_blocks.sort_order`            | the site must render Hero _before_ CTA         | **structure** |
| `post_authors.role`                 | the site may print "Written by X, edited by Y" | **structure** |
| `created_at`                        | returned by the API                            | **structure** |
| order of inputs in the edit form    | only the admin sees it                         | presentation  |
| label `"Article body"`              | only the admin sees it                         | presentation  |
| which columns show in the list view | only the admin sees it                         | presentation  |

**The trap:** `sort_order` and "field order" both sound like ordering and sit on opposite sides.
`sort_order` is the order of _content items inside an entry_ — an editor arranged those blocks and
the published page depends on it, so it is data. _Field order_ is the order of _inputs in a form_ —
admin chrome. Likewise `role` looks like metadata about a relationship, but it is a fact about the
content that a reader may see.

## Vocabulary

### Entities — the containers

An **entity** is one kind of thing an editor manages: posts, authors, site settings. It is the noun the
whole content layer is organised around, and it comes in two **kinds**.

"Entity" rather than "schema" is deliberate. A schema _describes_ something; it is not the thing. The
word is already doing three other jobs here — `config.schema` (the developer's Drizzle file),
`pgSchema`/`glaze_auth` (a database namespace), and the TypeBox request schemas — so using it for the
content model too made four unrelated meanings. Entities are the things; schemas describe them.

| Kind         | What it is                                                              | Editor sees                                     | Examples                             |
| ------------ | ----------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------ |
| **Multiple** | Many entries that all share the same shape.                             | A list you can add to, filter and page through. | blog posts · products · team members |
| **Single**   | Exactly one record. It always exists and cannot be added to or deleted. | One edit form, opened directly.                 | site settings · homepage · footer    |

The difference is _cardinality only_ — a Single is a Multiple guaranteed to hold exactly one row. Both
are ordinary tables.

Nothing in DDL distinguishes them: a table holding one row looks like any other. So `kind` is a
**declaration**, not something inference can recover — it belongs to the presentation layer. The
descriptor carries the key today, always `multiple`, so adding Singles later changes a value rather
than the shape.

### Structures — how fields are composed

A **field** is one value, stored in one column. Most content is just fields. The three structures
below exist for content that repeats or needs grouping, and the distinction between them is the
thing most often forgotten:

| Structure    | How many instances? | Are the instances the same shape?              |
| ------------ | ------------------- | ---------------------------------------------- |
| **Group**    | exactly one         | — (there is only one)                          |
| **Repeater** | many                | yes — every row identical                      |
| **Blocks**   | many                | no — each item picked from a palette of shapes |

**Group** — several related fields presented together under one heading. It does not repeat; it is
a visual bundle. The columns stay flat on the table, conventionally sharing a name prefix.

> An `seo` group holding _Meta title_, _Meta description_ and _OG image_. Stored as
> `seo_meta_title`, `seo_meta_description`, `seo_og_image_id` — three ordinary columns.

A group is **presentation only** (layer 2). Three prefixed columns and a group of three fields are
identical in the database, so convergence cannot see the difference. Regrouping fields is therefore
free — no migration.

**Repeater** — a list of rows that all have the same fields. The editor clicks _"Add row"_ and gets
the same inputs every time.

> A `features` repeater on a product, each row having an _icon_ and a _label_.

Stored as one JSON column holding an array. Note the consequence: the outer column is structural,
but the fields _inside_ have no DDL — no `NOT NULL`, no defaults, no foreign keys, and convergence
cannot see them.

**Blocks** — a list where each item may be a _different_ shape, chosen from a defined palette. The
editor clicks _"Add block"_ and picks which kind to insert. This is the page-builder pattern.

> A page whose `content` is a sequence of a _Hero_, then a _Rich text_, then a _Call to action_,
> in whatever order the editor arranged them.

A **block** is the definition of one of those shapes. Blocks are stored relationally — one table per
block type plus a junction table carrying the order — so they keep full constraints, are queryable,
and stay under convergence.

### Field types

What kind of value a field holds, and therefore which control the editor gets.

Eleven types, taken from the admin designs. Each carries its own configuration, and **that
configuration spans both layers** — see the table below.

| Type          | Holds                               | Editor control    | Configuration                        |
| ------------- | ----------------------------------- | ----------------- | ------------------------------------ |
| `shortText`   | a single line of plain text         | single-line input | max length                           |
| `longText`    | multi-line plain text               | textarea          | max length                           |
| `richText`    | formatted text with inline media    | rich text editor  | —                                    |
| `number`      | integer or decimal                  | number input      | decimal allowed · min · max          |
| `boolean`     | true / false                        | toggle            | default (True / no default / False)  |
| `datetime`    | a date, optionally with time        | date picker       | timezone-aware                       |
| `select`      | one choice from a fixed list        | dropdown          | options `{name, value}` · default    |
| `multiSelect` | several choices from a fixed list   | multi-select      | options `{name, value}` · defaults   |
| `color`       | a colour value                      | colour picker     | format (HEX · RGB · HSL)             |
| `media`       | an uploaded image or file           | media picker      | allowed types · preview size         |
| `relation`    | a link to entries in another entity | entry picker      | target · cardinality · display field |

Every type also carries **display name**, **description** (a hint under the field) and **required**.

**The pairs that get confused:**

- **`shortText` vs `longText`** — the same stored text; the difference is the control the editor
  gets and the length expected.
- **`select` vs `relation`** — `select` chooses from a fixed list defined once on the field
  (_draft · published · archived_). `relation` points at **rows in another entity**, so the
  available choices are content that editors create (_which author?_).
- **`media` vs `relation`** — `media` is a relation whose target is always the media library. It is
  named separately because it gets the upload/browse UI rather than a row picker.
- **option `name` vs `value`** — the name is shown to editors, the value is stored in the database.
  The name is presentation; the value is data.

### Field configuration spans both layers

**This is the most operationally important table in this document.** The admin's _Add field_ dialog
presents structural and presentational settings in one form, so a single submit can require **both a
migration and a presentation write.**

| Setting                                       | Layer         | Why                                             |
| --------------------------------------------- | ------------- | ----------------------------------------------- |
| Display name · description                    | presentation  | admin chrome only                               |
| **Required**                                  | **structure** | `NOT NULL`                                      |
| **Max length**                                | **structure** | `varchar(n)`                                    |
| **Decimal allowed**                           | **structure** | `integer` vs `numeric` — and lossy in reverse   |
| **Timezone**                                  | **structure** | `timestamptz` vs `timestamp`                    |
| **Default value**                             | **structure** | column `DEFAULT`                                |
| **Relation cardinality** (has one / has many) | **structure** | FK column vs junction table                     |
| Select option _names_                         | presentation  | the `value` is what's stored                    |
| Media allowed types · preview size            | presentation  | validation + rendering                          |
| Colour format (HEX/RGB/HSL)                   | presentation  | stored as text either way                       |
| Display field                                 | presentation  | which field identifies an entry                 |
| Number min / max                              | either        | presentation-only, unless enforced as a `CHECK` |

### Per-entity settings

Set in the admin's _Schema settings_ dialog. All presentation except where noted:

| Setting                    | Meaning                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Display name · description | how the entity is labelled                                                                            |
| **Display field**          | which field identifies an entry — used in the list's first column and in **every relation dropdown**  |
| **Default sorting**        | field + ascending/descending; the list endpoint's default, overridable per user from the table header |
| **Draft & Publish**        | whether entries can be drafted before publishing — **structural**, see Open                           |

`displayField` is worth calling out: without it an entry has no human-readable name, so both the
content table and every relation picker fall back to showing an id. It is chosen explicitly rather
than guessed.

## Layer 1 — structure stays on the snapshot

**Entities are plain Drizzle tables.** `server/content/loader.ts` identifies them by
`is(value, PgTable)`, so nothing may wrap or replace the table — that would break both entity
loading and what drizzle-kit diffs. Semantic annotation is not affected by this: the column stays a
plain Drizzle column, and the annotation lives in layer 2 rather than on the table.

The database is **not** the authority for structure, and four reasons hold it there:

1. **The DB cannot express intent.** A rename and a drop+create leave _identical_ end states with
   completely different data consequences. Introspection returns state; it can never return intent.
   The entire decision/resolution machinery exists to close that gap.
2. **The data-loss oracle needs an independent reference.** The oracle asserts _observed DB state_
   against _declared intent_, precisely because drizzle's own gating is provably incomplete. If the
   DB were the declared intent, the assertion is a tautology and the oracle collapses.
3. **Drizzle's diff engine is snapshot→snapshot.** "drizzle computes the change · Glaze applies and
   guards it" means adopting drizzle's model. DB-as-truth would mean `pull` on every hot path — slow,
   and the one API that hardcodes `better-sqlite3`.
4. **Shared reviewable history.** With `persist = yes` the migration + snapshot chain is committed,
   and conflict resolution comes free only because that shared history exists.

**None of these reach layers 2 or 3.** They are all about recovering intent for a destructive,
ambiguous change. A label rename is unambiguous, non-destructive, and has nothing to verify.

## Layer 2 — presentation lives in the DB

### Why the DB and not code

Presentation metadata has **no column to be read back from**. If an editor sets `body` to render as
rich text, no amount of introspection recovers that: `TEXT` is `TEXT` before and after. Convergence
has nothing to pick up, because convergence's input is the DB and the DB cannot hold the fact.

Code-only annotation therefore forces Glaze to write back into the user's source at runtime, which
fails in production for four independent reasons:

- the source may not be on disk (bundled, or `bun build --compile`'d into a single binary);
- container filesystems are typically read-only, and a write is lost on the next deploy;
- if it did persist, it takes effect only after a restart re-imports the module — renaming a label
  would require a redeploy;
- a running server would be mutating the git working tree of a repo it does not own.

### Why the DB and not a JSON file

Strapi is the natural experiment: it does **both**, split along this exact line, and both halves
have documented failure modes.

|                                     | JSON file (Strapi `schema.json`) | DB table (`glaze` namespace) |
| ----------------------------------- | -------------------------------- | ---------------------------- |
| Editor changes it in **production** | ✗ read-only FS · needs restart   | ✓ immediate                  |
| Git-tracked / reviewable            | ✓                                | ✗                            |
| Travels dev → staging → prod        | ✓ free                           | ✗ per-env reconfiguration    |
| Fresh clone renders correctly       | ✓                                | ✗ falls back to inference    |
| Survives `bun build --compile`      | ✗                                | ✓                            |
| Multi-instance consistency          | ✗ if written at runtime          | ✓ shared DB                  |
| Needs restart to take effect        | ✓                                | ✗                            |

Strapi's Content-Type Builder is **disabled in production** because its only persistence path is a
file write plus a restart ([docs](https://docs.strapi.io/cms/features/content-type-builder)); its
view configuration lives in `strapi_core_store_settings` and consequently **does not travel between
environments**, so every environment is reconfigured by hand
([forum](https://forum.strapi.io/t/database-migration-for-content-types-view-configuration-table/23907)).

Glaze accepts the second cost and rejects the first. Production editing by a non-technical user is
the thesis; per-environment presentation drift is an inconvenience with a known escape hatch (export
/ seed), and one that only bites teams running multiple environments.

**No code-declaration half.** A hybrid — code declares the default, DB stores the override — buys a
resolution rule and a conflict case for a layer that is only labels, ordering, visibility and
options: small and zero-risk. Revisit only if the fresh-clone or environment-portability cost is
felt in practice.

### Precedent

This is the existing rule applied consistently, not an exception to it. `./convergence.md` already
puts the **pending-approvals record** — requester, status, expected hash, target migration — in a DB
table "so it's shared/queryable across the team", while structure stays on the snapshot. Structure →
snapshot; human/collaboration layer → DB. Presentation is unambiguously the second category.

The `glaze` namespace itself is anticipated but **not yet built**: `glaze_auth` (PG schema) and
`zz__glaze_auth_` (SQLite prefix) exist in `server/auth/schema/schema.ts`, and
`convergence/orchestrator/preflight.ts` already notes that `glaze` / `zz__glaze` must be excluded
from user-table scope when it lands.

## Layer 3 — per-user view state

Sort column and direction, visible columns, column widths, density, page size, sidebar collapse.
Per user, per browser, zero server involvement, `localStorage`.

**Deferred:** _saved views_ — a named, shareable filter set. That is a collaboration feature,
localStorage cannot express it, and it belongs in the DB when it arrives. Not V1.

## Field types decompose — the routing rule

**"Field type" is not atomic.** It is `(storage type, semantic type, options)`, and the halves land
on opposite sides of the layer boundary. This is the operational rule the admin's "change field
type" action must implement.

| Change                               | Storage effect               | Layer        | Flow                                |
| ------------------------------------ | ---------------------------- | ------------ | ----------------------------------- |
| `text` → `richText`                  | `VARCHAR` → `JSONB`          | structure    | migration · data conversion · audit |
| `number` → `text`                    | `INTEGER` → `VARCHAR`, lossy | structure    | migration · data-loss oracle        |
| add / drop / rename a field          | column DDL                   | structure    | migration · audit                   |
| `text` → `select`                    | none — stays `VARCHAR`       | presentation | immediate                           |
| add / remove select options          | none, absent a `CHECK`       | presentation | immediate                           |
| relabel · reorder · hide · help text | none                         | presentation | immediate                           |

The storage half is Drizzle's and is already governed by convergence — **it needs nothing new.** The
semantic half plus options is the new metadata. An admin field-type change therefore _routes_: pure
semantic changes write to the `glaze` table and apply at once; storage-changing ones enter the
existing pipeline, with `workflow` deciding auto-apply vs. pending approval.

Consequence: **content types are structural.** An editor changing one in the admin UI is not editing
a metadata document — they are triggering convergence with admin origin, exactly as designed
(explicit intent, synchronous resolution in the API response).

## The entities endpoint

The admin cannot render anything without a machine-readable description of the content model. That
description is served by **one endpoint**, `GET {apiPrefix}/entities`, and four decisions fix its
contract. Its payload is a `ContentModel` — `{ entities: EntityDescriptor[] }`.

**1 — The server resolves semantic type; the admin never infers.** Each field carries its raw
structure _and_ a resolved `fieldType`, plus `fieldTypeSource` recording whether that came from
inference or a stored override. Two reasons: the same logical field is a different column per
dialect (`boolean` vs `integer({ mode: 'boolean' })`, `timestamp` vs `integer({ mode: 'timestamp' })`,
`pgEnum` vs `text({ enum })`), so client-side inference would put a dialect branch in the React app
— outside the seam and untestable by the matrix harness. And it keeps the admin on **one query key**
to cache and invalidate, rather than joining structure against overrides on every render.

**2 — Fields nest from day one.** The descriptor is `fields[]`, a tagged union, not a flat
`columns[]`. `kind: 'field' | 'group' | 'repeater' | 'blocks'` is defined up front so composites are
absorbed additively rather than breaking the endpoint the admin depends on most.

**3 — Building the tree merges both layers.** Because a group is presentation (layer 2) and fields
are structure (layer 1), the reader is not a pure Drizzle walk — it composes structural fields into
a tree whose grouping comes from the DB. Until layer 2 exists the tree is flat, but the resolver is
shaped for the merge from the start.

**4 — List totals ride `meta`, not `data`.** A list endpoint answers with `ApiListResponse`, whose
`meta` carries `{ total, limit, offset }` and is **required** rather than optional — an optional key
would force every consumer to null-check something the server always sends. `data` stays a bare array.

`total` is `number | null`, and counting is **opt-in** via `?count=true`. A count doubles the cost of
the hottest endpoint in the product, and a filtered scan pays for that scan twice, so only a paginated
view asks for it. When requested, the page and the count run in **one transaction**: identical
predicates do not imply identical results at different points in time, and issued concurrently on a
pooled connection a delete landing between them yields an envelope that contradicts itself — ten rows
alongside a total of three, from which a pager computes a negative page count.

**Filters are namespaced.** `?filter[title]=foo` for equality, `?filter[id][gt]=5` for an operator —
JSON:API's namespace with Strapi and Payload's nested-operator form. An unknown field or operator
_inside_ the namespace is a **422 rather than a silent no-op**, because a filter that quietly does
nothing returns more rows than the caller asked for. Parameters _outside_ it are ignored: a CDN, a WAF,
jQuery's `?_=1699999` and any shared link carrying `utm_source` all append parameters that belong to
the transport rather than the query, and a bare `?field=value` grammar hard-failed every one of them.

Operators: `eq` · `in` · `contains` · `startsWith` · `endsWith` · `gt` · `gte` · `lt` · `lte`. Two are
deliberately absent. There is no raw `like`: its `%`/`_` would be caller-controlled, an unanchored
leading wildcard is a guaranteed sequential scan, and its case sensitivity differs between the
dialects — the text operators escape the pattern and lower both sides instead. There is no `ne`:
`x <> 'a'` silently excludes rows where `x` is NULL, so `count(eq) + count(ne)` would not equal the
total, and a subtly wrong operator is worse than a missing one. Adding either later is additive.

**5 — Pure junction tables are consumed, not emitted.** A junction table is not a content type — it
is the storage mechanism behind a field. `post_tags` is how `posts.tags` is stored; `page_blocks` is
how `pages.content` is stored. But it is not ignorable either: it is the only evidence that two
entities are related. So the resolver **reads it to derive `relation` fields on both sides, then
drops it from the entity list.** An editor never sees "Post Tags" in the sidebar.

_Pure_ is load-bearing. Consume only when the composite PK columns **are** the foreign keys and
there are no other content-bearing columns. A junction carrying payload — `post_authors.role` — has
data an editor may need, so it stays a visible entity rather than having that column silently
disappear. `page_blocks` is the sanctioned exception: its `sort_order` is consumed as the blocks
field's ordering, so nothing is lost.

**Entity tables are not junctions.** `media` has a single-column PK and real attributes (filename,
mime, size), so it passes through as an ordinary entity with no special handling — while also
being the FK target that makes `fieldType: 'media'` inferable. Browsable library _and_ field target,
the same way Strapi treats it.

```json
{
	"name": "posts",
	"kind": "multiple",
	"label": "Posts",
	"description": null,
	"primaryKey": "id",
	"displayField": "title",
	"defaultSort": { "field": "id", "direction": "asc" },
	"draftPublish": false,
	"capabilities": { "byId": true, "create": true, "update": true, "delete": true },
	"fields": [
		{
			"kind": "field",
			"name": "title",
			"column": "title",
			"dataType": { "category": "string", "constraint": null },
			"isPrimaryKey": false,
			"fieldType": "shortText",
			"fieldTypeSource": "inferred",
			"label": "Title",
			"description": null,
			"relation": null,
			"config": {
				"required": true,
				"maxLength": null,
				"decimalAllowed": false,
				"timezone": false,
				"hasDefault": false,
				"defaultValue": null,
				"options": [],
				"colorFormat": null,
				"allowedTypes": [],
				"previewSize": null
			}
		},
		{
			"kind": "field",
			"name": "authorId",
			"column": "author_id",
			"dataType": { "category": "number", "constraint": "int53" },
			"isPrimaryKey": false,
			"fieldType": "relation",
			"fieldTypeSource": "inferred",
			"label": "Author",
			"description": null,
			"relation": {
				"entity": "authors",
				"column": "id",
				"cardinality": "one",
				"displayField": null,
				"writable": true
			},
			"config": {
				"required": false,
				"maxLength": null,
				"decimalAllowed": false,
				"timezone": false,
				"hasDefault": false,
				"defaultValue": null,
				"options": [],
				"colorFormat": null,
				"allowedTypes": [],
				"previewSize": null
			}
		}
	]
}
```

Taken from `examples/blog` — note `authorId` labels as `Author` (an id suffix is plumbing, not something
to show an editor), its `relation.column` names the target's **property**, and `dataType` is reported as
parsed halves rather than Drizzle’s raw compound string, which differs across dialects for the same
logical column.

## Current state

**Built.** `GET {apiPrefix}/schema` serves the descriptor above, gated by the auth macro and carried in
the standard envelope. `server/content/descriptor/` holds it: `types.ts` (the contract),
`inference.ts` (column facts → semantic type + structural config), `junctions.ts` (pure junctions →
relations), `resolver.ts` (composition). `loadEntities` now also reads each table's foreign keys and
composite primary key, keeping every dialect-specific `getTableConfig` call in that one file. List
responses carry `meta: { total, limit, offset }`, and accept `?sort=`/`?order=` plus
`?field=value` / `?field:op=value` filters — an unknown sort or filter is a 422 rather than a silent
no-op. `ApiResponse` and friends are exported from `glaze-cms/types`.

**Not built.** No `glaze` namespace, no presentation storage — so every presentation key resolves by
inference and `fieldTypeSource` is always `inferred`. `group`, `repeater` and `blocks` are reserved in
the union but never emitted. Many-to-many relations are read-only. Draft & Publish, search, bulk
operations and the media library do not exist.

**Inference rules as implemented.** Foreign key → `relation`, or `media` when it targets an entity
named `media`. `enumValues` → `select`. Constraint `date` → `datetime` (a timestamp is carried as
`object date`, so the category alone is not enough). Constraint `numeric`/`double` → `number`, which is
what keeps Postgres `numeric` — carried as a string to preserve precision — from reading as text. Text
defaults to `shortText`, becoming `longText` only above a declared length of 255: SQLite `text()`
carries no length at all, so defaulting the other way would give every title and slug a textarea. JSON
and binary → `unknown`, because guessing `richText` would put a document editor over arbitrary data.

## Open

- **Shape of the presentation table** — one row per (entity, field)? Column set. Whether
  entity-level presentation (display name, icon, list-view default columns) shares it.
- **Inference rules** — the exact mapping from column facts to `fieldType` when no override exists.
  Some are unambiguous (FK → `relation`, FK to the media table → `media`, `enumValues` → `select`,
  date → `datetime`); some are not (`jsonb` is `richText` _or_ `json`; `varchar(7)` is `color` _or_
  `text`). The ambiguous residue is precisely what layer 2 stores, so this rule set defines how far
  Glaze gets with no presentation data at all — and therefore whether layer 2 is optional.
- **Composite emission** — `repeater` and `blocks` are reserved in the union but not emitted. Open:
  how Glaze recognises a junction + per-block table set as a `blocks` relationship, and where a
  repeater's inner field definitions live given they have no DDL.
- **Draft & Publish** — needs its own design pass. The admin designs assume it throughout (list
  All/Published/Draft tabs, a State column, bulk publish/unpublish, Save-draft vs Publish in the
  editor, a per-entity enable toggle), and nothing in the backend models it. The open question is
  storage: a Glaze-managed column added to the user's table when the toggle flips — invasive, and
  convergence must own it — versus a row in the `glaze` namespace keyed by (entity, id) — clean
  separation, but the public content API must then join to filter published entries. Touches
  convergence, so it earns the §8 loop.
- **Search** — the list has a search box. Open whether it searches the display field only or all text
  fields, and whether that is `LIKE` or real full-text (which is dialect-divergent).
- **Bulk operations** — publish / unpublish / delete over a selection. Needs endpoints with
  partial-failure semantics.
- **Export / seed** — the escape hatch for presentation not travelling between environments.
- **Whether presentation overrides respect `workflow.audit`**, or always apply immediately. Leaning
  immediate: no data risk, and convergence's ceremony is earned by data-loss risk.
