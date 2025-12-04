# Glaze CMS - AI Agent Instructions

## Project Overview

Glaze is a next-generation CMS built on **Bun + Drizzle + Elysia + TanStack Start**. Philosophy: "Standing on giants" - we integrate best-in-class libraries rather than reinventing wheels.

**Core Architecture** (3-tier):

1. **TanStack Start** admin UI (port 3000) - SSR with server functions
2. **Elysia** backend API (port 4000) - extensible like Koa, type-safe
3. **Drizzle + PostgreSQL** - schema files are source of truth

## Critical Concepts

### Schema = Source of Truth

**Schema files** (not database) are authoritative. Changes flow: `schema.ts` → `drizzle-kit generate` → migration → database.

- Schema editing happens **in development only** (like Strapi)
- Production = content management only, no schema changes
- Schema changes must go through git

### Convergence Engine (Dev-Only)

On `bun dev` startup, detect schema drift between `src/schema.ts` and actual database:

- If drift detected → interactive CLI prompts: accept DB schema, reject changes, or show diff
- Uses `drizzle-kit check` for detection, `drizzle-kit pull` to extract DB schema
- **Philosophy**: Detection tool, not safety net - we inform, you decide

### Admin Metadata Tables

Three system tables store CMS configuration **separately from content**:

- `_glaze_settings` - global admin settings (singleton)
- `_glaze_entities` - per-content-type/field display config (key-value with JSONB)
- `_glaze_user_prefs` - user view preferences (per user, per context)

**Never pollute user content tables** with admin metadata.

## Development Workflow

### Running the Project

```bash
bun dev          # Start with hot reload + drift detection
bun build        # Build to dist/index.js
bun start        # Run production build
```

Entry point: `./src/index.ts` (currently minimal - project in early stages)

### Schema Changes

1. Edit schema files in `src/schema.ts` (Drizzle schemas)
2. Generate migration: `drizzle-kit generate --dialect=postgresql`
3. Apply migration: `drizzle-kit migrate`
4. Commit both schema AND migration files

### Type Safety Requirements

- **Strict TypeScript**: `noUncheckedIndexedAccess`, `noImplicitOverride`, full strict mode
- End-to-end type safety: DB → Drizzle types → Elysia routes → TanStack server functions → UI
- Use `verbatimModuleSyntax` - explicit type imports only

## Code Style & Conventions

### TypeScript Standards

- Module resolution: `bundler` mode (Bun-native)
- Target: `ESNext` with latest features
- Unused vars prefixed with `_` are allowed
- Prefer nullish coalescing (`??`) over logical OR when appropriate

### Formatting (Prettier)

- Single quotes, trailing commas, tabs (not spaces)
- Auto-format on save via `.vscode/settings.json`

### ESLint Rules

- `no-console: warn` except in `logger.ts` files
- No duplicate imports
- Prefer nullish coalescing
- Args ignore pattern: `^_`

## Planned Project Structure

```
packages/
├── core/          # Convergence engine, schema management, migrations
├── backend/       # Elysia API, plugins, content routes
├── admin/         # TanStack Start UI (content mgmt + schema editor)
└── cli/           # CLI commands (convergence:check, convergence:sync)
```

**Current status**: Early architecture phase. Most packages not yet implemented.

## Technology Stack (Locked Decisions)

| Layer    | Tech           | Why                                    |
| -------- | -------------- | -------------------------------------- |
| Runtime  | Bun            | 3x faster than Node, native TypeScript |
| Backend  | Elysia         | Type-safe, Bun-native, plugin system   |
| Frontend | TanStack Start | SSR + typed server functions           |
| ORM      | Drizzle        | Schema-first, type-safe, lightweight   |
| Database | PostgreSQL     | JSONB support, production-ready        |
| Auth     | Better-Auth    | Battle-tested, not custom              |

**Never suggest alternatives** to these core technologies - they're locked decisions.

## Environment-Aware Features

### Development Only

- Schema editor UI
- Convergence engine (drift detection)
- Admin API endpoints for schema modifications

### All Environments

- Content management (CRUD)
- Auto-generated REST API from schemas
- Better-Auth authentication

## Key Design Patterns

### Plugin Extensibility (Elysia)

```typescript
// glaze.config.ts
export default {
	plugins: [customAnalytics()],
	extend: (app: Elysia) => {
		app.group('/api/custom', (app) => app.get('/analytics', handler));
	},
};
```

### Auto-Generated Content API

For each schema table, generate:

```
GET/POST    /api/{table}
GET/PUT/DEL /api/{table}/:id
```

With query support: `?filter[status]=published&sort=-createdAt&limit=10`

## Common Pitfalls

1. **Don't modify DB directly in production** - Convergence is dev-only
2. **Don't add admin fields to content tables** - use `_glaze_*` tables
3. **Don't bypass schema workflow** - schema.ts → migration → DB (never manual ALTER)
4. **Don't use Node.js patterns** - this is Bun (check Bun APIs first)
5. **Don't skip migrations** - always generate + apply when changing schemas

## Documentation

Full architecture: `documentation/glaze-summary.md` (comprehensive technical spec)

## Current Project State

**Status**: Architecture defined, early implementation phase. Most packages are placeholders. When implementing:

- Reference the technical summary for design decisions
- Maintain type safety throughout
- Follow the dev/prod separation model
- Keep it simple - V1 focuses on core CMS features
