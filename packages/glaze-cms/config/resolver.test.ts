import { expect, test } from '#harness';

import { resolveConfig } from './resolver.ts';

test('resolveConfig fills every optional field with its default', () => {
	const resolved = resolveConfig({ dialect: 'sqlite', connection: ':memory:' });
	expect(resolved.schema).toEqual({});
	expect(resolved.migrations).toBe('./drizzle');
	expect(resolved.workflow).toEqual({ mode: 'solo' });
});

test('resolveConfig passes provided values through untouched', () => {
	const schema = { widget: {} };
	const resolved = resolveConfig({
		dialect: 'postgres',
		connection: 'postgres://localhost/db',
		schema,
		migrations: './migrations',
		workflow: { mode: 'team' },
	});
	expect(resolved.dialect).toBe('postgres');
	expect(resolved.connection).toBe('postgres://localhost/db');
	expect(resolved.schema).toBe(schema);
	expect(resolved.migrations).toBe('./migrations');
	expect(resolved.workflow).toEqual({ mode: 'team' });
});
