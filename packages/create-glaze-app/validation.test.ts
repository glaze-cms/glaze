import { describe, expect, test } from 'bun:test';
import {
	validateProjectName,
	validateDatabaseUrl,
	generateAuthSecret,
} from './validation';

describe('validateProjectName', () => {
	test('rejects empty string', () => {
		expect(validateProjectName('')).toBe('Please enter a directory name.');
	});

	test('rejects whitespace-only string', () => {
		expect(validateProjectName('   ')).toBe(
			'Please enter a directory name.',
		);
	});

	test('rejects undefined (default param)', () => {
		expect(validateProjectName()).toBe('Please enter a directory name.');
	});

	test('rejects absolute path', () => {
		expect(validateProjectName('/foo/bar')).toBe(
			'Please use a folder name like "my-glaze-app", not a full path.',
		);
	});

	test('rejects absolute path with nested dirs', () => {
		expect(validateProjectName('/a/b/my-app')).toBe(
			'Please use a folder name like "my-glaze-app", not a full path.',
		);
	});

	test('rejects ".." traversal', () => {
		expect(validateProjectName('../my-app')).toBe(
			'Please use a folder name like "my-glaze-app" without ".." segments.',
		);
	});

	test('rejects nested ".." traversal', () => {
		expect(validateProjectName('a/../../my-app')).toBe(
			'Please use a folder name like "my-glaze-app" without ".." segments.',
		);
	});

	test('rejects bare ".."', () => {
		expect(validateProjectName('..')).toBe(
			'Please use a folder name like "my-glaze-app" without ".." segments.',
		);
	});

	test('rejects bare "."', () => {
		expect(validateProjectName('.')).toBe(
			'Please use a folder name like "my-glaze-app" without ".." segments.',
		);
	});

	test('accepts simple folder name', () => {
		expect(validateProjectName('my-app')).toBeUndefined();
	});

	test('accepts nested relative path', () => {
		expect(validateProjectName('a/b/my-app')).toBeUndefined();
	});

	test('accepts dot-relative path', () => {
		expect(validateProjectName('./my-app')).toBeUndefined();
	});
});

describe('validateDatabaseUrl', () => {
	test('rejects empty string', () => {
		expect(validateDatabaseUrl('')).toBe('Please enter a database URL.');
	});

	test('rejects whitespace-only string', () => {
		expect(validateDatabaseUrl('   ')).toBe('Please enter a database URL.');
	});

	test('rejects non-postgres URL', () => {
		expect(validateDatabaseUrl('mysql://localhost')).toContain(
			'Must be a valid PostgreSQL connection string',
		);
	});

	test('rejects plain string', () => {
		expect(validateDatabaseUrl('not-a-url')).toContain(
			'Must be a valid PostgreSQL connection string',
		);
	});

	test('rejects protocol-only postgresql://', () => {
		expect(validateDatabaseUrl('postgresql://')).toContain(
			'missing a host',
		);
	});

	test('rejects protocol-only postgres://', () => {
		expect(validateDatabaseUrl('postgres://')).toContain('missing a host');
	});

	test('rejects URL with newline injection', () => {
		expect(
			validateDatabaseUrl(
				'postgresql://localhost:5432/mydb\nEVIL_VAR=injected',
			),
		).toContain('must not contain newlines');
	});

	test('accepts URL with leading/trailing whitespace', () => {
		expect(
			validateDatabaseUrl('  postgres://localhost:5432/mydb  '),
		).toBeUndefined();
	});

	test('accepts postgres:// URL', () => {
		expect(
			validateDatabaseUrl('postgres://localhost:5432/mydb'),
		).toBeUndefined();
	});

	test('accepts postgresql:// URL', () => {
		expect(
			validateDatabaseUrl('postgresql://user:pass@host:5432/mydb'),
		).toBeUndefined();
	});

	test('accepts Supabase-style URL', () => {
		expect(
			validateDatabaseUrl(
				'postgresql://postgres.abc:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
			),
		).toBeUndefined();
	});
});

describe('generateAuthSecret', () => {
	test('returns a 64-character hex string', () => {
		const secret = generateAuthSecret();
		expect(secret).toHaveLength(64);
		expect(secret).toMatch(/^[0-9a-f]{64}$/);
	});

	test('generates unique values', () => {
		const a = generateAuthSecret();
		const b = generateAuthSecret();
		expect(a).not.toBe(b);
	});
});
