import { getAuthTables } from 'better-auth/db';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig as getPgTableConfig } from 'drizzle-orm/pg-core';
import { getTableConfig as getSqliteTableConfig } from 'drizzle-orm/sqlite-core';

import { expect, test } from '#harness';

import {
	AUTH_PG_SCHEMA,
	AUTH_SQLITE_PREFIX,
	buildAuthSchema,
	type AuthModelName,
} from './schema.ts';

import type { Dialect } from '#dialect';
import type { Column, Table } from 'drizzle-orm';

/**
 * The contract guard for Glaze's hand-written auth tables.
 *
 * Every expectation is derived from **Better Auth's own `getAuthTables`**, never from a list maintained
 * alongside the schema. That is the whole point: a guard whose expected values live in the file it
 * checks can only assert that its author was self-consistent, and passes unchanged when the
 * dependency's contract moves underneath it. Deriving means `bun install` pulling a new Better Auth
 * minor turns a runtime 500 into a red gate.
 *
 * Comparisons are by **property name**, not database column name. Better Auth's Drizzle adapter
 * resolves a field as `schema[model][fieldName]` — a property lookup on the table object — so the
 * property keys are the contract surface. The DB column names underneath (`email_verified` and friends)
 * are Glaze's own naming convention and are checked separately, only for namespacing.
 */

const MODELS: readonly AuthModelName[] = ['user', 'session', 'account', 'verification'];

/** The physical (plural) table name Glaze uses for each Better Auth model. */
const TABLE_NAMES: Record<AuthModelName, string> = {
	user: 'users',
	session: 'sessions',
	account: 'accounts',
	verification: 'verifications',
};

/** Better Auth's declared tables, built with no options — the core contract every Glaze app must meet. */
const AUTH_TABLES = getAuthTables({});

/**
 * Better Auth's declaration for one model. Throwing on a miss is itself part of the guard: if an
 * upgrade drops or renames a core model, that should be a loud failure rather than a silently skipped
 * set of assertions.
 *
 * @param model - The Better Auth model name.
 * @returns Its declared table.
 * @throws {Error} When Better Auth no longer declares the model.
 */
function authTable(model: AuthModelName) {
	const table = AUTH_TABLES[model];
	if (!table) throw new Error(`Better Auth no longer declares the "${model}" model`);
	return table;
}

/** A table's shape as read back from Drizzle, keyed by property name and dialect-agnostic. */
interface TableShape {
	/** Property name → whether the column is NOT NULL. */
	readonly columns: ReadonlyMap<string, boolean>;
	/** Column-name tuples covered by a UNIQUE constraint or unique index. */
	readonly uniques: readonly string[][];
	/** Column-name tuples covered by any index, unique or not. */
	readonly indexes: readonly string[][];
}

/**
 * Reads a Drizzle table's shape, translating every column reference back to its property name.
 *
 * Drizzle expresses a single-column unique as a flag on the column and a multi-column one as a table
 * constraint or unique index; all three are normalised into `uniques`, so the two dialects' schemas do
 * not compare unequal for reasons unrelated to Better Auth.
 *
 * @param table - The Drizzle table object.
 * @param dialect - The dialect that built it.
 * @returns The normalised shape.
 */
function readTableShape(table: unknown, dialect: Dialect): TableShape {
	const properties = getTableColumns(table as Table);
	// Drizzle hands index definitions an `IndexedColumn` WRAPPER rather than the column object itself,
	// so identity lookup silently finds nothing. Both maps exist because unique constraints carry the
	// real column while indexes carry the wrapper; each resolves through whichever key it has.
	const byIdentity = new Map<Column, string>(
		Object.entries(properties).map(([property, column]) => [column, property]),
	);
	const byColumnName = new Map<string, string>(
		Object.entries(properties).map(([property, column]) => [column.name, property]),
	);
	const config =
		dialect === 'postgres'
			? getPgTableConfig(table as Parameters<typeof getPgTableConfig>[0])
			: getSqliteTableConfig(table as Parameters<typeof getSqliteTableConfig>[0]);

	const toProperties = (columns: readonly unknown[]): string[] =>
		columns
			.map((column) => {
				const identity = byIdentity.get(column as Column);
				if (identity) return identity;
				const { name } = (column ?? {}) as { name?: string };
				return name === undefined ? undefined : byColumnName.get(name);
			})
			.filter((name): name is string => name !== undefined)
			.toSorted();

	const columnUniques = Object.entries(properties)
		.filter(([, column]) => column.isUnique)
		.map(([property]) => [property]);
	const constraintUniques = (config.uniqueConstraints ?? []).map((constraint) =>
		toProperties(constraint.columns),
	);
	const indexes = config.indexes.map((entry) => ({
		columns: toProperties((entry.config.columns ?? []) as unknown[]),
		unique: entry.config.unique,
	}));

	return {
		columns: new Map(
			Object.entries(properties).map(([property, column]) => [property, column.notNull]),
		),
		uniques: [
			...columnUniques,
			...constraintUniques,
			...indexes.filter((entry) => entry.unique).map((entry) => entry.columns),
		],
		indexes: indexes.map((entry) => entry.columns),
	};
}

/**
 * Better Auth's expected field names for a model, including the implicit `id` primary key that
 * `getAuthTables` does not list among `fields`.
 *
 * @param model - The Better Auth model name.
 * @returns The expected property names, sorted.
 */
function expectedColumns(model: AuthModelName): string[] {
	return ['id', ...Object.keys(authTable(model).fields)].toSorted();
}

/**
 * Field tuples Better Auth requires a UNIQUE constraint on: single fields marked `unique`, plus any
 * table-level index declared `unique` — which is how 1.7 expresses account identity as
 * `(issuer, accountId)`.
 *
 * @param model - The Better Auth model name.
 * @returns Sorted field-name tuples.
 */
function expectedUniques(model: AuthModelName): string[][] {
	const table = authTable(model);
	const fieldUniques = Object.entries(table.fields)
		.filter(([, field]) => field.unique)
		.map(([name]) => [name]);
	const declaredUniques = (table.indexes ?? [])
		.filter((entry) => entry.unique)
		.map((entry) => [...entry.fields].toSorted());
	return [...fieldUniques, ...declaredUniques];
}

/**
 * Field tuples Better Auth expects a plain (non-unique) index on.
 *
 * Uniques are deliberately excluded: both engines create an implicit index to enforce a UNIQUE
 * constraint, so requiring a second explicit one would fail on a schema that is in fact correct. The
 * uniques assertion covers those.
 *
 * @param model - The Better Auth model name.
 * @returns Field-name tuples.
 */
function expectedIndexes(model: AuthModelName): string[][] {
	return Object.entries(authTable(model).fields)
		.filter(([, field]) => field.index)
		.map(([name]) => [name]);
}

/**
 * The required tuples absent from a schema's declared tuples.
 *
 * @param actual - Tuples the schema declares.
 * @param required - Tuples Better Auth requires.
 * @returns The missing tuples, rendered for the failure message.
 */
function missingTuples(actual: readonly string[][], required: readonly string[][]): string[] {
	const present = new Set(actual.map((tuple) => tuple.join('+')));
	return required.map((tuple) => tuple.join('+')).filter((key) => !present.has(key));
}

for (const dialect of ['postgres', 'sqlite'] as const) {
	test(`${dialect} auth schema has exactly Better Auth's fields`, () => {
		const schema = buildAuthSchema(dialect);

		for (const model of MODELS) {
			const shape = readTableShape(schema[model], dialect);
			expect([...shape.columns.keys()].toSorted()).toEqual(expectedColumns(model));
		}
	});

	test(`${dialect} auth schema declares every UNIQUE constraint Better Auth requires`, () => {
		const schema = buildAuthSchema(dialect);

		for (const model of MODELS) {
			const shape = readTableShape(schema[model], dialect);
			// Named in the assertion because this failing is how a Better Auth minor that re-keys a model
			// announces itself, and the message is the only clue the reader gets.
			const missing = missingTuples(shape.uniques, expectedUniques(model));
			expect(`${model} missing unique: ${missing.join(', ')}`).toBe(`${model} missing unique: `);
		}
	});

	test(`${dialect} auth schema declares every index Better Auth requires`, () => {
		const schema = buildAuthSchema(dialect);

		for (const model of MODELS) {
			const shape = readTableShape(schema[model], dialect);
			const missing = missingTuples(shape.indexes, expectedIndexes(model));
			expect(`${model} missing index: ${missing.join(', ')}`).toBe(`${model} missing index: `);
		}
	});

	test(`${dialect} auth schema marks Better Auth's required fields NOT NULL`, () => {
		const schema = buildAuthSchema(dialect);

		for (const model of MODELS) {
			const shape = readTableShape(schema[model], dialect);
			const nullable = Object.entries(authTable(model).fields)
				.filter(([name, field]) => field.required && shape.columns.get(name) !== true)
				.map(([name]) => name);
			expect(`${model} nullable: ${nullable.join(', ')}`).toBe(`${model} nullable: `);
		}
	});
}

test('postgres auth tables live in the glaze_auth namespace', () => {
	const schema = buildAuthSchema('postgres');

	for (const model of MODELS) {
		const config = getPgTableConfig(schema[model] as Parameters<typeof getPgTableConfig>[0]);
		expect(config.schema).toBe(AUTH_PG_SCHEMA);
		expect(config.name).toBe(TABLE_NAMES[model]);
	}
});

test('sqlite auth tables carry the zz__glaze_auth_ prefix', () => {
	const schema = buildAuthSchema('sqlite');

	for (const model of MODELS) {
		const config = getSqliteTableConfig(
			schema[model] as Parameters<typeof getSqliteTableConfig>[0],
		);
		expect(config.name).toBe(`${AUTH_SQLITE_PREFIX}${TABLE_NAMES[model]}`);
	}
});

test('no RBAC leaked in: the user table carries no role column on either dialect', () => {
	for (const dialect of ['postgres', 'sqlite'] as const) {
		const shape = readTableShape(buildAuthSchema(dialect).user, dialect);
		expect(shape.columns.has('role')).toBe(false);
	}
});
