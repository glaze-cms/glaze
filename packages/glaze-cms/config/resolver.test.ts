import { expect, test } from '#harness';

import { resolveConfig } from './resolver.ts';

test('resolveConfig fills every optional field with its default', () => {
	const resolved = resolveConfig({ dialect: 'sqlite', connection: ':memory:' });
	expect(resolved.schema).toBe(undefined);
	expect(resolved.migrations).toEqual({ enabled: true, path: './drizzle' });
	expect(resolved.workflow).toEqual({ audit: false });
});

test('resolveConfig passes provided values through untouched', () => {
	const resolved = resolveConfig({
		dialect: 'postgres',
		connection: 'postgres://localhost/db',
		schema: './schema/*.ts',
		migrations: { enabled: false, path: './migrations' },
		workflow: { audit: true },
	});
	expect(resolved.dialect).toBe('postgres');
	expect(resolved.connection).toBe('postgres://localhost/db');
	expect(resolved.schema).toBe('./schema/*.ts');
	expect(resolved.migrations).toEqual({ enabled: false, path: './migrations' });
	expect(resolved.workflow).toEqual({ audit: true });
});

test('resolveConfig fills each migrations field on its own', () => {
	// Setting the path must not silently turn keeping the files off, or vice versa — they are two
	// facts, and a half-given object should not answer the other one.
	const pathOnly = resolveConfig({
		dialect: 'sqlite',
		connection: ':memory:',
		migrations: { path: './db/migrations' },
	});
	expect(pathOnly.migrations).toEqual({ enabled: true, path: './db/migrations' });

	const enabledOnly = resolveConfig({
		dialect: 'sqlite',
		connection: ':memory:',
		migrations: { enabled: false },
	});
	expect(enabledOnly.migrations).toEqual({ enabled: false, path: './drizzle' });
});

test('resolveConfig keeps auditing independent of keeping the migrations', () => {
	// Working alone with a history of every change, answered at the terminal: a legitimate way to
	// work that was inexpressible while these were one setting called `mode`.
	const resolved = resolveConfig({
		dialect: 'sqlite',
		connection: ':memory:',
		migrations: { enabled: true },
		workflow: { audit: false },
	});
	expect(resolved.migrations.enabled).toBe(true);
	expect(resolved.workflow.audit).toBe(false);
});
