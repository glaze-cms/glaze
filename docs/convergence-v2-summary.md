# Glaze Convergence Engine v2 - Architecture Summary

## Overview

Convergence is Glaze's schema synchronization engine. It keeps the database schema in sync with the application schema, handling changes from both developers (code) and administrators (Admin UI).

---

## Architecture Comparison

### v1: Reactive Detection

```
Changes accumulate → drizzle-kit detects drift → opaque SQL → cryptic errors
```

### v2: Proactive Control

```
Single operation → known SQL → predictable result → clear error if failure
```

**Why this matters:**

- Granular error handling with translatable messages
- Rollback possible (nothing else touched if one operation fails)
- Predictable UX for admin users

---

## Workflows

### Two Dimensions

| Dimension | Options          | Description                  |
| --------- | ---------------- | ---------------------------- |
| **Mode**  | `solo` / `team`  | Who's working on the project |
| **Apply** | `auto` / `audit` | How changes are applied      |

### Four Resulting Flows

#### 1. Dev + Solo

```
Edit schema in code → Hot reload detects changes → Convergence detects drift → Push to DB directly
```

- Fastest iteration loop
- No migration files
- Direct database updates

#### 2. Dev + Team + Auto

```
Edit schema in code → Hot reload → Generate migration file → Apply immediately → WebSocket notifies Admin UI
```

- Migration files for version control
- Automatic application
- Real-time UI sync

#### 3. Dev + Team + Audit

```
Edit schema in code → Hot reload → Generate migration file → Migration stays pending → Dev runs CLI to apply → CLI syncs hashes → WebSocket notifies Admin UI
```

- Migration files for version control
- Manual approval required
- Hash comparison for tracking

#### 4. Admin + Solo

```
HTTP request (POST/PATCH) → Generate safe SQL → Apply to DB → Handle success/error → Introspect DB → Regenerate schema in code
```

- Granular operations
- Immediate feedback
- Code stays in sync via introspection

#### 5. Admin + Team + Auto

```
HTTP request → Generate migration → Apply immediately → Introspect DB → Regenerate schema
```

- Migration files generated
- Automatic application
- Code regenerated from DB state

#### 6. Admin + Team + Audit

```
HTTP request → Generate migration → Save pending metadata with expected hash → Return "pending approval" → Dev applies via CLI → CLI compares hashes with __drizzle_migrations → CLI updates status → WebSocket notifies Admin UI → Field becomes enabled
```

- Full audit trail
- Developer approval required
- Automatic status sync via hash comparison

---

## Route Structure

### Schema Operations (Admin UI)

```
POST   /schema/collections                    # Create collection
PATCH  /schema/collections/:collection        # Rename collection
DELETE /schema/collections/:collection        # Drop collection

POST   /schema/collections/:collection/fields         # Add field
PATCH  /schema/collections/:collection/fields/:field  # Alter field
DELETE /schema/collections/:collection/fields/:field  # Drop field

POST   /schema/collections/:collection/relations      # Add relation
DELETE /schema/collections/:collection/relations/:rel # Drop relation

POST   /schema/collections/:collection/indexes        # Create index
DELETE /schema/collections/:collection/indexes/:name  # Drop index

GET    /schema/pending                        # List pending migrations
GET    /schema/status                         # Convergence status
```

### Content API (Public)

```
GET    /api/:collection                       # List entries
POST   /api/:collection                       # Create entry
GET    /api/:collection/:id                   # Get entry
PATCH  /api/:collection/:id                   # Update entry
DELETE /api/:collection/:id                   # Delete entry
```

---

## Internal API

### Operation Types

```typescript
type OperationResult<T = void> =
	| { success: true; sql: string; data?: T }
	| { success: false; code: ErrorCode; error: Record<string, unknown> };
```

### Error Codes (for i18n)

```typescript
type ErrorCode =
	// Field errors
	| 'FIELD_NOT_NULL_NO_DEFAULT'
	| 'FIELD_ALREADY_EXISTS'
	| 'FIELD_NOT_FOUND'
	| 'FIELD_TYPE_INCOMPATIBLE'
	| 'FIELD_REFERENCED_BY_RELATION'
	// Collection errors
	| 'COLLECTION_ALREADY_EXISTS'
	| 'COLLECTION_NOT_FOUND'
	| 'COLLECTION_HAS_DATA'
	| 'COLLECTION_REFERENCED_BY_RELATION'
	// Relation errors
	| 'RELATION_TARGET_NOT_FOUND'
	| 'RELATION_CIRCULAR_REFERENCE'
	// General
	| 'INVALID_IDENTIFIER'
	| 'RESERVED_NAME';
```

### Schema Operations Interface

```typescript
interface SchemaOperations {
	// Collections
	createCollection(params: {
		name: string;
		fields: FieldDef[];
	}): Promise<OperationResult>;
	renameCollection(params: {
		collection: string;
		newName: string;
	}): Promise<OperationResult>;
	dropCollection(params: {
		collection: string;
		cascade?: boolean;
	}): Promise<OperationResult>;

	// Fields
	addField(params: {
		collection: string;
		field: FieldDef;
	}): Promise<OperationResult>;
	alterField(params: {
		collection: string;
		field: string;
		changes: Partial<FieldDef>;
	}): Promise<OperationResult>;
	renameField(params: {
		collection: string;
		field: string;
		newName: string;
	}): Promise<OperationResult>;
	dropField(params: {
		collection: string;
		field: string;
	}): Promise<OperationResult>;

	// Relations
	addRelation(params: {
		collection: string;
		field: string;
		target: string;
		type: RelationType;
	}): Promise<OperationResult>;
	dropRelation(params: {
		collection: string;
		field: string;
	}): Promise<OperationResult>;

	// Indexes
	createIndex(params: {
		collection: string;
		fields: string[];
		unique?: boolean;
		name?: string;
	}): Promise<OperationResult>;
	dropIndex(params: {
		collection: string;
		name: string;
	}): Promise<OperationResult>;
}
```

### Executor

Pseudo code to illustrate

```typescript
class SchemaExecutor {
	constructor(
		private db: Sql,
		private config: { mode: 'solo' | 'team'; audit: boolean },
	) {}

	async execute(
		result: OperationResult,
		description: string,
	): Promise<ExecutionResult> {
		if (!result.success) return result;

		if (this.config.mode === 'solo') {
			await this.db.unsafe(result.sql);
			return { success: true, applied: true };
		}

		if (this.config.mode === 'team') {
			const migration = await this.generateMigration(result.sql);

			if (this.config.audit) {
				await this.savePending(migration, description);
				return { success: true, applied: false, migration: migration.name };
			} else {
				await this.applyMigration(migration);
				return { success: true, applied: true, migration: migration.name };
			}
		}
	}
}
```

---

## Pending Changes Tracking

Admins need to know on audit mode wich changes are pending to be approved.
We track those on the DB. Drizzle has `formatToMillis` from drizzle-orm/migrator - we use that
to compare hashes.

### Database Schema

```typescript
export const glazePendingMigrations = glazeSchema.table('pending_migrations', {
	migrationName: text('migration_name').primaryKey(),
	migrationTimestamp: bigint('migration_timestamp', {
		mode: 'number',
	}).notNull(),

	// Lifecycle
	generatedAt: timestamp('generated_at').notNull().defaultNow(),
	appliedAt: timestamp('applied_at'),

	// Status
	status: text('status').notNull().default('pending'), // pending | applied | failed

	// Failure tracking
	errorMessage: text('error_message'),

	// Context (human-readable for Admin UI)
	description: text('description'), // "Added field 'bio' to Authors"

	// Hash for automatic sync
	expectedHash: text('expected_hash'),
});
```

### Hash-Based Status Sync

When dev runs `bun glaze migrate:apply`:

1. CLI applies migrations via drizzle-kit
2. CLI reads `__drizzle_migrations` table
3. CLI compares hashes with `glaze_pending_migrations`
4. CLI updates status to `applied` for matching hashes
5. (Optional) WebSocket notifies Admin UI

**No manual action required from dev** beyond running the CLI command.

---

## SQL Generation

Using `postgres` driver for safe SQL escaping:

```typescript
function ident(name: string): string {
	if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
		throw new Error(`Invalid identifier: ${name}`);
	}
	return `"${name}"`;
}

function buildAddColumnSQL(table: string, field: FieldDef): string {
	const parts = [
		`ALTER TABLE ${ident(table)}`,
		`ADD COLUMN ${ident(field.name)}`,
		mapType(field.type),
	];

	if (!field.nullable) parts.push('NOT NULL');
	if (field.default !== undefined)
		parts.push(`DEFAULT ${escapeValue(field.default)}`);

	return parts.join(' ') + ';';
}
```

---

## i18n Strategy

- API returns error `code` + `error`
- UI translates code to localized message
- First-class citizen, not afterthought

```typescript
// API Response
{
  success: false,
  code: 'FIELD_NOT_NULL_NO_DEFAULT',
  error: { field: 'bio', collection: 'authors' }
}

// UI Translation
const messages = {
  en: {
    'FIELD_NOT_NULL_NO_DEFAULT': ({ field, collection }) =>
      `Cannot add required field "${field}" to ${collection} because it has existing data.`
  },
  es: {
    'FIELD_NOT_NULL_NO_DEFAULT': ({ field, collection }) =>
      `No se puede agregar el campo requerido "${field}" a ${collection} porque tiene datos existentes.`
  }
}
```

---

## Introspection

After Admin UI changes in Solo mode:

```
SQL executes → Success → (Background) Introspect DB → Regenerate .ts schema files
```

- **Non-blocking**: Admin gets immediate response
- **Eventually consistent**: Code updates within seconds
- **Optional WebSocket**: Notify when schema files regenerated

## Key Decisions

| Decision                 | Result                                         |
| ------------------------ | ---------------------------------------------- |
| Config file vs code-only | **Code-only**                                  |
| Architecture             | **Proactive control** (not reactive detection) |
| Mode names               | **solo/team** + **auto/audit**                 |
| Pending tracking         | **Hash comparison** (automatic CLI sync)       |
| Dev marks applied in UI? | **No**, CLI does it automatically              |
| i18n                     | **First-class**, API returns codes             |
| Introspection            | **Background**, non-blocking                   |

---

## Transition Rules

| From | To   | Allowed?          |
| ---- | ---- | ----------------- |
| Solo | Solo | ✅                |
| Solo | Team | ✅                |
| Team | Team | ✅                |
| Team | Solo | ❌ (irreversible) |

**Reason:** Team mode establishes migration history that Solo mode ignores. Reverting risks data integrity.

---

## File Structure

```
.glaze/
  metadata.json      # Workflow state (git tracked)
  prototype.json     # Prototype mode flag (git ignored)
  .gitignore         # Ignores prototype.json

drizzle/
  migrations/        # Migration SQL files (team mode)
    0001_xxx.sql
    0002_xxx.sql
```

---

## CLI Commands

```bash
bun glaze migrate:apply      # Apply pending migrations + sync status
bun glaze migrate:generate   # Generate migration from current drift
bun glaze team:prototype     # Enable prototype mode (skip auto-migrations)
bun glaze upgrade-to-team    # Upgrade from solo to team workflow
```

---

## Summary

1. **Granular operations** instead of batch drift detection
2. **Predictable errors** with i18n support
3. **Clear workflows** for different team sizes and deployment needs
4. **Automatic tracking** via hash comparison
5. **Non-blocking introspection** for Admin UI responsiveness
