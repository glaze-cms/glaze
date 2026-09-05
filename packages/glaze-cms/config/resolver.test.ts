import { expect, test } from '#harness';

import { resolveConfig } from './resolver.ts';

test('resolveConfig fills every optional field with its default', () => {
	const resolved = resolveConfig({ dialect: 'sqlite', connection: ':memory:' });
	expect(resolved.schema).toBe(undefined);
	expect(resolved.migrations).toBe('./drizzle');
	expect(resolved.workflow).toEqual({ mode: 'solo', audit: false });
});

test('resolveConfig passes provided values through untouched', () => {
	const resolved = resolveConfig({
		dialect: 'postgres',
		connection: 'postgres://localhost/db',
		schema: './schema/*.ts',
		migrations: './migrations',
		workflow: { mode: 'team' },
	});
	expect(resolved.dialect).toBe('postgres');
	expect(resolved.connection).toBe('postgres://localhost/db');
	expect(resolved.schema).toBe('./schema/*.ts');
	expect(resolved.migrations).toBe('./migrations');
	expect(resolved.workflow).toEqual({ mode: 'team', audit: true });
});

test('resolveConfig defaults audit from the mode', () => {
	const solo = resolveConfig({ dialect: 'sqlite', connection: ':memory:', workflow: {} });
	expect(solo.workflow).toEqual({ mode: 'solo', audit: false });

	const team = resolveConfig({
		dialect: 'sqlite',
		connection: ':memory:',
		workflow: { mode: 'team' },
	});
	expect(team.workflow).toEqual({ mode: 'team', audit: true });
});

test('resolveConfig keeps mode and audit independent', () => {
	// Both crossed combinations are legitimate ways to work and were inexpressible while auditing
	// was derived from the mode.
	const soloAudited = resolveConfig({
		dialect: 'sqlite',
		connection: ':memory:',
		workflow: { mode: 'solo', audit: true },
	});
	expect(soloAudited.workflow).toEqual({ mode: 'solo', audit: true });

	const teamUnaudited = resolveConfig({
		dialect: 'sqlite',
		connection: ':memory:',
		workflow: { mode: 'team', audit: false },
	});
	expect(teamUnaudited.workflow).toEqual({ mode: 'team', audit: false });
});
