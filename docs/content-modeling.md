# Glaze CMS - Content Modeling Specification

> Defines how content is structured, stored, and presented in Glaze CMS.

---

## Core Principles

**Drizzle schemas are the source of truth.** Users define their database structure using standard Drizzle ORM `pgTable` definitions. Glaze does not wrap or replace Drizzle — it reads the schemas directly.

CMS-specific concerns (Admin UI component choices, field ordering, visual grouping) are stored as **metadata in Glaze's internal Postgres schema**, not in user code.

---

## Core Concepts

### Content Types

| Type           | Purpose                            | Example                            |
| -------------- | ---------------------------------- | ---------------------------------- |
| **Collection** | Multiple entries of same structure | Blog posts, Products, Team members |
| **Single**     | One-off content, single record     | Site Settings, Homepage, Footer    |

### How Users Define Schemas

Users write standard Drizzle `pgTable` definitions:

```typescript
import { pgTable, uuid, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const posts = pgTable('posts', {
	id: uuid('id').defaultRandom().primaryKey(),
	title: text('title').notNull(),
	slug: text('slug').notNull(),
	content: text('content'),
	status: text('status').default('draft'),
	views: integer('views').default(0),
	createdAt: timestamp('created_at').default(sql`now()`),
	updatedAt: timestamp('updated_at').default(sql`now()`),
});
```

Glaze introspects these schemas at startup to generate CRUD routes and feed the Convergence engine.

---

## CMS Metadata

Glaze stores Admin UI metadata in its internal schema (e.g. `glaze.collection_metadata`). This controls how fields are presented in the Admin UI without affecting the database structure.

```json
{
	"collection": "posts",
	"fields": {
		"title": { "order": 1, "component": "input" },
		"content": { "order": 2, "component": "richtext" },
		"status": { "order": 3, "component": "select", "options": ["draft", "published"] }
	},
	"groups": [
		{ "name": "SEO", "fields": ["seoTitle", "seoDescription"] }
	]
}
```

- **component**: Which Admin UI widget to use (input, richtext, select, media, etc.)
- **order**: Field display order in the editor
- **groups**: Visual grouping of fields (collapsible sections in the Admin UI)

This metadata is editable from the Admin UI and stored in Postgres — it does not modify user code.

---

## Field Types

These are the field types Glaze recognizes when introspecting Drizzle schemas. The Admin UI uses the Postgres column type to determine default components, which can be overridden via metadata.

### Primitives

| Drizzle Type    | Default Admin Component | Storage           |
| --------------- | ----------------------- | ----------------- |
| `text`          | Text input              | VARCHAR / TEXT    |
| `text` (JSONB)  | Rich text editor        | JSONB             |
| `integer`       | Number input            | INTEGER           |
| `numeric`       | Number input            | NUMERIC           |
| `boolean`       | Toggle                  | BOOLEAN           |
| `timestamp`     | Date/time picker        | TIMESTAMP         |
| `jsonb`         | JSON editor             | JSONB             |

### Relational

| Pattern                      | Default Admin Component | Storage                   |
| ---------------------------- | ----------------------- | ------------------------- |
| FK column → other table      | Relation picker         | INTEGER/UUID FK           |
| FK column → media table      | Media picker            | INTEGER/UUID FK           |

---

## Layout Helpers (Admin UI Only)

These are metadata-driven UI features — they do **not** affect the database schema. Users define columns in Drizzle; the Admin UI groups and presents them.

| Feature          | Admin UI Experience               | Metadata Driven |
| ---------------- | --------------------------------- | --------------- |
| **Groups**       | Collapsible section of fields     | Yes             |
| **Field Order**  | Custom ordering in the editor     | Yes             |
| **Components**   | Override default widget per field | Yes             |

### Groups Example

Given a Drizzle schema with SEO fields:

```typescript
export const pages = pgTable('pages', {
	id: uuid('id').defaultRandom().primaryKey(),
	title: text('title').notNull(),
	slug: text('slug').notNull(),
	seoTitle: text('seo_title'),
	seoDescription: text('seo_description'),
	createdAt: timestamp('created_at').default(sql`now()`),
});
```

The Admin UI metadata groups them:

```json
{
	"collection": "pages",
	"groups": [
		{ "name": "SEO", "fields": ["seoTitle", "seoDescription"] }
	]
}
```

The Admin UI renders "SEO" as a collapsible section — the DB schema is flat.

---

## API Response Shape

### Collection Item

```json
{
	"id": "uuid-1",
	"title": "Welcome",
	"slug": "welcome",
	"seoTitle": "Welcome to Our Site",
	"seoDescription": "...",
	"createdAt": "2024-12-10T...",
	"updatedAt": "2024-12-10T..."
}
```

API responses reflect the flat DB structure. Grouping is a UI-only concern.

---

## Field Naming Convention

Drizzle's existing pattern — users control both code key and database column:

```typescript
export const pages = pgTable('pages', {
	publishedAt: timestamp('published_at'),
	//  ^^ code key (camelCase)   ^^ database column (snake_case)
});
```

- **Object key**: Used in code and API responses (camelCase)
- **Column name**: Database column (snake_case)
- **Admin label**: Derived from key or overridden via metadata

---

## Deferred to V2

- `location/geo` field (PostGIS complexity)
- Repeater fields (JSONB arrays with structured editing)
- Block/page builder pattern (junction tables)
- Nested content structures

---

## References

- [ACF Field Types](https://www.advancedcustomfields.com/resources/) - Inspiration for layout helpers
- [Strapi Components](https://docs.strapi.io/dev-docs/backend-customization/models) - Dynamic zones
- [Payload Blocks](https://payloadcms.com/docs/fields/blocks) - Block field pattern
