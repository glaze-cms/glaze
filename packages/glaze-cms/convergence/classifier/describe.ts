/**
 * One line of plain English per operation, for the terminal prompt, the boot log and the trail.
 */

import type { UnsafeChange } from '../safety/index.ts';
import type { Operation } from './types.ts';

/** The verb for each operation kind. */
const VERB = { create: 'add', drop: 'drop', alter: 'change' } as const;

/** Singular nouns for the entity types drizzle writes. */
const NOUN: Readonly<Record<string, string>> = {
	tables: 'table',
	columns: 'column',
	indexes: 'index',
	uniques: 'unique constraint',
	fks: 'foreign key',
	pks: 'primary key',
	checks: 'check constraint',
	enums: 'enum',
	schemas: 'schema',
	views: 'view',
	sequences: 'sequence',
	roles: 'role',
	policies: 'policy',
	privileges: 'privilege',
};

/**
 * Describes an operation: `drop column posts.body`, `change column posts.price (numeric(10,4) →
 * numeric(10,2))`, `add foreign key posts.fk_author`.
 *
 * @param operation - The operation.
 * @returns The description.
 */
export function describeOperation(operation: Operation): string {
	if (operation.entityType === 'snapshot') {
		return `read the previous snapshot (${operation.detail ?? 'unreadable'})`;
	}
	const noun = NOUN[operation.entityType] ?? operation.entityType;
	const target = qualify(
		operation.schema,
		operation.table ? `${operation.table}.${operation.name}` : operation.name,
	);
	const changed =
		operation.op === 'alter' && operation.changed?.length
			? ` [${operation.changed.join(', ')}]`
			: '';
	const detail = operation.detail ? ` (${operation.detail})` : '';
	return `${VERB[operation.op]} ${noun} ${target}${changed}${detail}`;
}

/**
 * Prefixes a name with its schema when that is not the default, so `archive.t` cannot be read as
 * `public.t`.
 *
 * @param schema - The schema, or `undefined`.
 * @param name - The dotted name.
 * @returns The name, qualified when it needs to be.
 */
function qualify(schema: string | undefined, name: string): string {
	return schema && schema !== 'public' ? `${schema}.${name}` : name;
}

/**
 * Describes a destructive change by what it does to stored values.
 *
 * @param change - The change.
 * @returns The description.
 */
export function describeChange(change: UnsafeChange): string {
	const table = qualify(change.schema, change.table);
	switch (change.kind) {
		case 'drop_table':
			return `drop table ${table}`;
		case 'drop_column':
			return `drop column ${table}.${change.column}`;
		case 'narrow_column':
			return `narrow column ${table}.${change.column} to ${change.maxLength} characters`;
		case 'set_not_null':
			return `require a value in ${table}.${change.column}`;
		case 'add_not_null_column':
			return `add required column ${table}.${change.column}`;
		case 'add_unique':
			return `make ${table}.${change.column} unique`;
		default: {
			const unexpected: never = change;
			throw new Error(`Unknown change kind: ${JSON.stringify(unexpected)}`);
		}
	}
}
