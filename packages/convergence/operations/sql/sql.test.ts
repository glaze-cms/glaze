import { describe, it, expect } from 'bun:test';

import {
	mapType,
	buildCreateTableSQL,
	buildRenameTableSQL,
	buildDropTableSQL,
	buildAddColumnSQL,
	buildRenameColumnSQL,
	buildDropColumnSQL,
	buildSetNotNullSQL,
	buildDropNotNullSQL,
	buildSetDefaultSQL,
	buildDropDefaultSQL,
} from './sql';

// Note: pg-format's %I (quote_ident semantics) only wraps identifiers in
// double-quotes when they require it — reserved words (e.g. "user") or names
// that contain spaces or special characters. Plain lowercase alphanumeric
// identifiers are emitted unquoted.

// ─── mapType ──────────────────────────────────────────────────────────────────

describe('mapType', () => {
	it('maps text → TEXT', () => {
		expect(mapType('text')).toBe('TEXT');
	});

	it('maps integer → INTEGER', () => {
		expect(mapType('integer')).toBe('INTEGER');
	});

	it('maps boolean → BOOLEAN', () => {
		expect(mapType('boolean')).toBe('BOOLEAN');
	});

	it('maps timestamp → TIMESTAMP', () => {
		expect(mapType('timestamp')).toBe('TIMESTAMP');
	});

	it('maps uuid → UUID', () => {
		expect(mapType('uuid')).toBe('UUID');
	});

	it('maps jsonb → JSONB', () => {
		expect(mapType('jsonb')).toBe('JSONB');
	});

	it('maps numeric → NUMERIC', () => {
		expect(mapType('numeric')).toBe('NUMERIC');
	});
});

// ─── buildCreateTableSQL ──────────────────────────────────────────────────────

describe('buildCreateTableSQL', () => {
	it('builds a basic table with a single column', () => {
		const sql = buildCreateTableSQL('articles', [
			{ name: 'id', type: 'uuid' },
		]);
		expect(sql).toBe('CREATE TABLE articles (id UUID);');
	});

	it('adds PRIMARY KEY for a primaryKey column', () => {
		const sql = buildCreateTableSQL('posts', [
			{ name: 'id', type: 'uuid', primaryKey: true },
		]);
		expect(sql).toBe('CREATE TABLE posts (id UUID PRIMARY KEY);');
	});

	it('adds NOT NULL when nullable is false', () => {
		const sql = buildCreateTableSQL('posts', [
			{ name: 'title', type: 'text', nullable: false },
		]);
		expect(sql).toBe('CREATE TABLE posts (title TEXT NOT NULL);');
	});

	it('does not add NOT NULL when nullable is true', () => {
		const sql = buildCreateTableSQL('posts', [
			{ name: 'subtitle', type: 'text', nullable: true },
		]);
		expect(sql).toBe('CREATE TABLE posts (subtitle TEXT);');
	});

	it('does not add NOT NULL when nullable is omitted', () => {
		const sql = buildCreateTableSQL('posts', [
			{ name: 'subtitle', type: 'text' },
		]);
		expect(sql).toBe('CREATE TABLE posts (subtitle TEXT);');
	});

	it('quotes a string literal default with single quotes', () => {
		const sql = buildCreateTableSQL('posts', [
			{ name: 'status', type: 'text', default: 'draft' },
		]);
		expect(sql).toBe(`CREATE TABLE posts (status TEXT DEFAULT 'draft');`);
	});

	it('emits a number default unquoted', () => {
		const sql = buildCreateTableSQL('posts', [
			{ name: 'views', type: 'integer', default: 0 },
		]);
		expect(sql).toBe('CREATE TABLE posts (views INTEGER DEFAULT 0);');
	});

	it('emits TRUE for a boolean true default', () => {
		const sql = buildCreateTableSQL('posts', [
			{ name: 'published', type: 'boolean', default: true },
		]);
		expect(sql).toBe('CREATE TABLE posts (published BOOLEAN DEFAULT TRUE);');
	});

	it('emits FALSE for a boolean false default', () => {
		const sql = buildCreateTableSQL('posts', [
			{ name: 'published', type: 'boolean', default: false },
		]);
		expect(sql).toBe('CREATE TABLE posts (published BOOLEAN DEFAULT FALSE);');
	});

	it('emits NULL for a null default', () => {
		const sql = buildCreateTableSQL('posts', [
			{ name: 'deleted_at', type: 'timestamp', default: null },
		]);
		expect(sql).toBe(
			'CREATE TABLE posts (deleted_at TIMESTAMP DEFAULT NULL);',
		);
	});

	it('emits an expression default unquoted and raw', () => {
		const sql = buildCreateTableSQL('events', [
			{ name: 'created_at', type: 'timestamp', default: { expr: 'NOW()' } },
		]);
		expect(sql).toBe(
			'CREATE TABLE events (created_at TIMESTAMP DEFAULT NOW());',
		);
	});

	it('adds UNIQUE constraint for a unique column', () => {
		const sql = buildCreateTableSQL('users', [
			{ name: 'email', type: 'text', unique: true },
		]);
		expect(sql).toBe('CREATE TABLE users (email TEXT UNIQUE);');
	});

	it('does not add UNIQUE to a PRIMARY KEY column even when unique: true', () => {
		const sql = buildCreateTableSQL('users', [
			{ name: 'id', type: 'uuid', primaryKey: true, unique: true },
		]);
		expect(sql).toBe('CREATE TABLE users (id UUID PRIMARY KEY);');
	});

	it('double-quotes a table name containing spaces', () => {
		const sql = buildCreateTableSQL('user table', [
			{ name: 'id', type: 'uuid' },
		]);
		expect(sql).toBe('CREATE TABLE "user table" (id UUID);');
	});

	it('double-quotes a table name that is a reserved word', () => {
		const sql = buildCreateTableSQL('user', [{ name: 'id', type: 'uuid' }]);
		expect(sql).toBe('CREATE TABLE "user" (id UUID);');
	});

	it('joins multiple columns with commas', () => {
		const sql = buildCreateTableSQL('articles', [
			{ name: 'id', type: 'uuid', primaryKey: true },
			{ name: 'title', type: 'text', nullable: false },
			{ name: 'views', type: 'integer', default: 0 },
		]);
		expect(sql).toBe(
			'CREATE TABLE articles (id UUID PRIMARY KEY, title TEXT NOT NULL, views INTEGER DEFAULT 0);',
		);
	});
});

// ─── buildRenameTableSQL ──────────────────────────────────────────────────────

describe('buildRenameTableSQL', () => {
	it('produces ALTER TABLE ... RENAME TO ...', () => {
		const sql = buildRenameTableSQL('posts', 'articles');
		expect(sql).toBe('ALTER TABLE posts RENAME TO articles;');
	});

	it('quotes both old and new names when they contain spaces', () => {
		const sql = buildRenameTableSQL('old table', 'new table');
		expect(sql).toBe('ALTER TABLE "old table" RENAME TO "new table";');
	});
});

// ─── buildDropTableSQL ────────────────────────────────────────────────────────

describe('buildDropTableSQL', () => {
	it('produces DROP TABLE for a plain identifier', () => {
		const sql = buildDropTableSQL('articles');
		expect(sql).toBe('DROP TABLE articles;');
	});

	it('quotes a table name with spaces', () => {
		const sql = buildDropTableSQL('user data');
		expect(sql).toBe('DROP TABLE "user data";');
	});
});

// ─── buildAddColumnSQL ────────────────────────────────────────────────────────

describe('buildAddColumnSQL', () => {
	it('produces ALTER TABLE ... ADD COLUMN with a basic column', () => {
		const sql = buildAddColumnSQL('posts', { name: 'slug', type: 'text' });
		expect(sql).toBe('ALTER TABLE posts ADD COLUMN slug TEXT;');
	});

	it('includes NOT NULL and DEFAULT when specified', () => {
		const sql = buildAddColumnSQL('posts', {
			name: 'status',
			type: 'text',
			nullable: false,
			default: 'draft',
		});
		expect(sql).toBe(
			`ALTER TABLE posts ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';`,
		);
	});
});

// ─── buildRenameColumnSQL ─────────────────────────────────────────────────────

describe('buildRenameColumnSQL', () => {
	it('produces ALTER TABLE ... RENAME COLUMN ... TO ...', () => {
		const sql = buildRenameColumnSQL('posts', 'slug', 'permalink');
		expect(sql).toBe('ALTER TABLE posts RENAME COLUMN slug TO permalink;');
	});

	it('quotes identifiers that contain spaces', () => {
		const sql = buildRenameColumnSQL('my table', 'old col', 'new col');
		expect(sql).toBe(
			'ALTER TABLE "my table" RENAME COLUMN "old col" TO "new col";',
		);
	});
});

// ─── buildDropColumnSQL ───────────────────────────────────────────────────────

describe('buildDropColumnSQL', () => {
	it('produces ALTER TABLE ... DROP COLUMN ...', () => {
		const sql = buildDropColumnSQL('posts', 'slug');
		expect(sql).toBe('ALTER TABLE posts DROP COLUMN slug;');
	});

	it('quotes identifiers that contain spaces', () => {
		const sql = buildDropColumnSQL('my table', 'old col');
		expect(sql).toBe('ALTER TABLE "my table" DROP COLUMN "old col";');
	});
});

// ─── buildSetNotNullSQL ───────────────────────────────────────────────────────

describe('buildSetNotNullSQL', () => {
	it('produces ALTER TABLE ... ALTER COLUMN ... SET NOT NULL', () => {
		const sql = buildSetNotNullSQL('posts', 'title');
		expect(sql).toBe('ALTER TABLE posts ALTER COLUMN title SET NOT NULL;');
	});
});

// ─── buildDropNotNullSQL ──────────────────────────────────────────────────────

describe('buildDropNotNullSQL', () => {
	it('produces ALTER TABLE ... ALTER COLUMN ... DROP NOT NULL', () => {
		const sql = buildDropNotNullSQL('posts', 'subtitle');
		expect(sql).toBe('ALTER TABLE posts ALTER COLUMN subtitle DROP NOT NULL;');
	});
});

// ─── buildSetDefaultSQL ───────────────────────────────────────────────────────

describe('buildSetDefaultSQL', () => {
	it('single-quotes a string literal default', () => {
		const sql = buildSetDefaultSQL('posts', 'status', 'draft');
		expect(sql).toBe(
			`ALTER TABLE posts ALTER COLUMN status SET DEFAULT 'draft';`,
		);
	});

	it('emits a number default unquoted', () => {
		const sql = buildSetDefaultSQL('posts', 'views', 0);
		expect(sql).toBe('ALTER TABLE posts ALTER COLUMN views SET DEFAULT 0;');
	});

	it('emits TRUE for a boolean true default', () => {
		const sql = buildSetDefaultSQL('posts', 'published', true);
		expect(sql).toBe(
			'ALTER TABLE posts ALTER COLUMN published SET DEFAULT TRUE;',
		);
	});

	it('emits FALSE for a boolean false default', () => {
		const sql = buildSetDefaultSQL('posts', 'published', false);
		expect(sql).toBe(
			'ALTER TABLE posts ALTER COLUMN published SET DEFAULT FALSE;',
		);
	});

	it('emits NULL for a null default', () => {
		const sql = buildSetDefaultSQL('posts', 'deleted_at', null);
		expect(sql).toBe(
			'ALTER TABLE posts ALTER COLUMN deleted_at SET DEFAULT NULL;',
		);
	});

	it('emits an expression default raw and unquoted', () => {
		const sql = buildSetDefaultSQL('users', 'id', {
			expr: 'gen_random_uuid()',
		});
		expect(sql).toBe(
			'ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();',
		);
	});
});

// ─── buildDropDefaultSQL ──────────────────────────────────────────────────────

describe('buildDropDefaultSQL', () => {
	it('produces ALTER TABLE ... ALTER COLUMN ... DROP DEFAULT', () => {
		const sql = buildDropDefaultSQL('posts', 'status');
		expect(sql).toBe('ALTER TABLE posts ALTER COLUMN status DROP DEFAULT;');
	});
});
