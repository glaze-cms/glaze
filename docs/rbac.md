# Glaze CMS — RBAC Technical Spec V1

## Context

Glaze currently has authentication via Better-Auth but no authorization layer. Every authenticated user has full access to everything. The Content API has a basic "is logged in?" guard on mutations, and the Schema API (`/schema/*`) has **no auth at all** — the convergence operation endpoints are completely unprotected. This spec defines the RBAC system needed to control what each user can do.

**Core principle:** Glaze allows non-developers to modify schemas through the Admin UI. Roles control _what actions_ a user can perform, not _how technical_ they are.

---

## Roles

Four fixed roles, highest to lowest privilege:

| Role     | Purpose                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin`  | Full system access. Users, settings, schema, content. The first user created is always admin.                                                                       |
| `editor` | Schema + content management. Can structure collections, create/edit/publish/delete content across all collections. No access to user management or system settings. |
| `writer` | Content creation only. Can create and edit their own entries. Cannot delete, publish, or touch schema.                                                              |
| `guest`  | Read-only. Can view content and schema in the Admin UI but cannot modify anything.                                                                                  |

---

## Entitlement Domains

Each role maps to a set of entitlements across six domains:

| Domain                                                          | admin | editor | writer                 | guest     |
| --------------------------------------------------------------- | ----- | ------ | ---------------------- | --------- |
| **System settings** (app name, logo, locale)                    | full  | none   | none                   | none      |
| **User management** (invite, assign roles, deactivate)          | full  | none   | none                   | none      |
| **Schema operations** (collections, fields, relations, indexes) | full  | full   | none                   | read-only |
| **Content — own entries** (create, read, update)                | full  | full   | create + read + update | read-only |
| **Content — all entries** (read, update)                        | full  | full   | none                   | read-only |
| **Content — destructive** (delete, publish/unpublish)           | full  | full   | none                   | none      |

### Open questions

- **Writer scope:** Does writer only see/edit their own entries, or can they see all entries but only edit their own? Current assumption: writer can only access their own entries. This requires a `created_by` column on every content table.
- **Editor delete:** Should editor be able to delete content, or should that be admin-only as a safety net? Current assumption: editor can delete.
- **Guest access to Admin UI:** Should guest be able to log into the admin panel at all, or is guest purely an API consumer? Current assumption: guest can access admin UI in read-only mode.

---

## Database Changes

### 1. Role field on users

Add a `role` column to the existing Better-Auth `auth.users` table. Better-Auth supports extending the user schema with additional fields.

```
auth.users
├── ...existing columns...
└── role: text NOT NULL DEFAULT 'writer'
```

The default role for new users should be configurable by the admin. The first user created bypasses this and is always `admin`.

### 2. Content ownership tracking

Every user-defined content table needs a `created_by` column to support writer-scoped access. This should be automatically injected by the CRUD generator, not manually added by the user.

```
public.<any_collection>
├── ...user-defined columns...
├── created_by: text REFERENCES auth.users(id)
└── updated_by: text REFERENCES auth.users(id)
```

---

## Enforcement Points

### 1. Content API (`/api/:collection/*`)

The CRUD route generator currently has a basic auth guard (is user logged in?). This needs to be extended to check role entitlements per operation:

- `GET` — guest and above
- `POST` — writer and above
- `PATCH/PUT` — writer and above (with ownership check for writers)
- `DELETE` — editor and above

Writer requests must be filtered by `created_by = current_user.id` for both reads and writes.

### 2. Schema API (`/schema/*`)

**Currently unprotected — no auth guards exist on these routes.** The convergence operation endpoints need both authentication and role-based authorization:

- All mutations (`POST`, `PATCH`, `DELETE`) — editor and above
- Read operations (`GET /schema/status`, `GET /schema/pending`) — guest and above

This is a security gap that RBAC should close.

### 3. Admin API

New endpoints needed for user management:

- `GET/POST/PATCH /admin/users` — admin only

### 4. Admin UI

The frontend must reflect the user's role:

- Hide navigation items the user can't access (e.g., writer shouldn't see Settings or Users)
- Disable action buttons (e.g., guest sees content but all edit/delete buttons are hidden)
- Schema editing UI hidden for writer and guest
- The UI should feel intentional, not broken — "you don't have access" is better than a 403 after clicking

---

## Suggested Approaches

### Guard via Elysia macro

Use Elysia's macro system to create a declarative `requireRole` guard that can be applied per-route or per-group. This keeps authorization logic out of individual handlers.

```typescript
// Usage on a route
.post('/schema/collections', handler, { requireRole: 'editor' })

// Usage on a group
.guard({ requireRole: 'admin' }, (app) =>
  app
    .get('/admin/users', listUsers)
    .post('/admin/users', createUser)
)
```

The macro resolves the user from the session (already derived by the auth plugin) and checks their role against the required minimum. Returns 401 if not authenticated, 403 if insufficient role.

### Entitlements as string patterns

Define entitlements as `domain:action` strings (e.g., `schema:write`, `content:delete`, `users:manage`). Map each role to a static set of entitlements. The guard checks entitlement inclusion, not role names — this way V2 can introduce per-collection entitlements (`content:posts:write`) without changing the guard interface.

### Role from session, not from DB

The user's role should be included in the Better-Auth session payload so it's available on every request without an extra DB query. Better-Auth supports custom fields on the user object — the `role` column added to `auth.users` should be surfaced through the session derive.

### Ownership filter via query modifier

For writer-scoped access, inject a WHERE clause (`created_by = current_user.id`) at the query level in the CRUD generator, not in the handler. This ensures writers can never accidentally access other users' entries regardless of how the API is called.

### Admin UI: entitlement endpoint

Expose a `GET /api/auth/entitlements` endpoint that returns the current user's entitlement set. The Admin UI fetches this on login and uses it to conditionally render navigation, buttons, and form fields. This keeps the UI logic simple (check entitlement set) and decoupled from role names.

---

## What This Spec Does NOT Cover (V2+)

- **System settings table** (`glaze.settings` for editable app name, logo, etc.)
- **Onboarding flow** (first-user creation wizard, app name setup)
- **Per-collection permissions** (e.g., editor can edit Posts but not Products)
- **Per-field permissions** (e.g., hide salary field from writers)
- **Custom roles** (user-defined roles beyond the four fixed ones)
- **Workflow states** (draft → review → published pipeline with role-based transitions)
- **API tokens with scoped permissions** (for external integrations)
- **Audit logging** (who did what, when)

These are intentionally deferred. The V1 entitlement map is designed so that per-collection granularity can be layered on top (e.g., `content:posts:create` extending `content:create`) without breaking the existing guard system.
