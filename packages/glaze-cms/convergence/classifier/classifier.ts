/**
 * The classifier: reads the difference between two snapshots and has something to say about every
 * operation in it.
 *
 * This is the load-bearing rule of the pending-approvals design. An earlier version decided from the
 * measurements alone, so a diff that produced no measurement read as "destroys nothing" — when it
 * meant "nothing here knew what to measure". A populated table drop, a rename beside a column drop
 * and a `numeric(10,4) → numeric(10,2)` narrowing all applied silently that way. Here the absence of
 * a rule is itself an answer: the operation is unclassified, and the change waits for a person.
 *
 * Three steps, all pure: apply the renames the resolver answered to the parent snapshot, so a rename
 * reads as a rename; diff the two `ddl` arrays by entity identity; sort each operation with the rule
 * table below. `specs/design/pending-approvals.md` § "The classifier must account for every operation".
 *
 * Every measurement it hands out names what the live database has **now**, schema included: a column
 * under a table being renamed is counted under the old table name, and `shop.orders` is never
 * mistaken for `public.orders`.
 */

import type { UnsafeChange } from '../safety/index.ts';
import type {
	Classification,
	ColumnRename,
	Entity,
	Operation,
	OperationKind,
	Renames,
	TableRename,
} from './types.ts';

/** The schema every SQLite entity is treated as living in; drizzle uses the same name in hints. */
const DEFAULT_SCHEMA = 'public';

/** Fields that identify an entity rather than describe it; a difference in these is a different entity. */
const IDENTITY_FIELDS = new Set(['entityType', 'schema', 'table', 'name']);

/** Entity types whose creation is additive on its own (nothing stored can be affected). */
const ADDITIVE_WHEN_CREATED = new Set(['tables', 'enums', 'schemas', 'views']);

/** Entity types whose removal takes nothing stored with it: a constraint or index holds no values. */
const ADDITIVE_WHEN_DROPPED = new Set(['indexes', 'uniques', 'fks', 'checks', 'pks']);

/** Entity types the database may refuse to add over existing rows, with nothing yet that measures it. */
const UNCLASSIFIED_WHEN_CREATED = new Set(['fks', 'checks', 'pks']);

/** Postgres types the database fills itself, so a `NOT NULL` column of one needs no value from anybody. */
const SELF_FILLING_TYPES = /^(?:small|big)?serial$/i;

/**
 * What a rule says about one operation: applies, waits, is covered by a larger operation (a column of
 * a table that is itself created or dropped), or needs these measurements.
 */
type Verdict = 'additive' | 'unclassified' | 'covered' | readonly UnsafeChange[];

/**
 * The names things have in the live database right now. A measurement runs against the database as
 * it is, before the migration, so a column under a table being renamed has to be counted under the
 * table's current name — the snapshot diff speaks in new names, the database still answers to old.
 */
interface LiveNames {
	/** The live name of a table, given its schema and its name in the new snapshot. */
	table(schema: string, name: string): string;
	/** The live name of a column, given its table's schema and name and its own name in the new snapshot. */
	column(schema: string, table: string, name: string): string;
}

/** What the sorter knows about the change as a whole, beyond the one entity in front of it. */
interface Context {
	/** Tables that exist only in the new snapshot, keyed by {@link tableIdentity}. */
	readonly createdTables: ReadonlySet<string>;
	/** Tables that exist only in the parent, keyed by {@link tableIdentity}. */
	readonly droppedTables: ReadonlySet<string>;
	/** Columns that exist only in the new snapshot, keyed by {@link columnIdentity}. */
	readonly createdColumns: ReadonlyMap<string, Entity>;
	readonly live: LiveNames;
}

/** The two sides of one entity across the snapshots, keyed and compared. */
interface Difference {
	readonly op: OperationKind;
	readonly before: Entity | undefined;
	readonly after: Entity | undefined;
	readonly operation: Operation;
}

/**
 * Reads a string field, or `undefined` when absent or not a string.
 *
 * @param entity - The entity.
 * @param field - The field name.
 * @returns The string, or `undefined`.
 */
function text(entity: Entity | undefined, field: string): string | undefined {
	const value = entity?.[field];
	return typeof value === 'string' ? value : undefined;
}

/**
 * The schema an entity lives in: its own, or the default on SQLite.
 *
 * @param entity - The entity.
 * @returns The schema name.
 */
function schemaOf(entity: Entity): string {
	return text(entity, 'schema') ?? DEFAULT_SCHEMA;
}

/**
 * The identity of an entity: type, schema, owning table and name, NUL-separated so identifiers with
 * spaces cannot collide.
 *
 * @param entity - The entity to key.
 * @returns The composite key.
 */
function identityOf(entity: Entity): string {
	return [
		entity.entityType,
		schemaOf(entity),
		text(entity, 'table') ?? '',
		text(entity, 'name') ?? '',
	].join('\0');
}

/**
 * The identity of a table, as its own entity or as the owner of another.
 *
 * @param schema - The schema.
 * @param table - The table name.
 * @returns The composite key.
 */
function tableIdentity(schema: string, table: string): string {
	return `${schema}\0${table}`;
}

/**
 * The identity of a column.
 *
 * @param schema - The schema.
 * @param table - The table name.
 * @param column - The column name.
 * @returns The composite key.
 */
function columnIdentity(schema: string, table: string, column: string): string {
	return `${schema}\0${table}\0${column}`;
}

/**
 * The table an entity belongs to, or is, keyed like {@link tableIdentity}.
 *
 * @param entity - The entity.
 * @returns The owning table's key, or `undefined` for an entity with no table.
 */
function ownerOf(entity: Entity): string | undefined {
	const name = entity.entityType === 'tables' ? text(entity, 'name') : text(entity, 'table');
	return name === undefined ? undefined : tableIdentity(schemaOf(entity), name);
}

/**
 * A stable serialisation for comparing field values, so key order cannot fake a difference.
 *
 * @param value - Any JSON-shaped value.
 * @returns The canonical text.
 */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`);
		return `{${entries.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'undefined';
}

/**
 * A short rendering of a field value for a person: strings bare, everything else as JSON.
 *
 * @param value - The value.
 * @returns The rendering.
 */
function show(value: unknown): string {
	if (value === undefined || value === null) return 'none';
	return typeof value === 'string' ? value : canonical(value);
}

/**
 * The column names an index or unique constraint covers. Drizzle writes a unique constraint's
 * columns as names and an index's as objects (`{ value, isExpression, … }`); an expression is not a
 * column and yields `null`, as does anything else unexpected.
 *
 * @param entity - The index or unique entity.
 * @returns The column names, or `null` when one of them is not a plain column.
 */
function coveredColumns(entity: Entity): string[] | null {
	const columns = entity['columns'];
	if (!Array.isArray(columns)) return null;
	const names: string[] = [];
	for (const item of columns) {
		if (typeof item === 'string') names.push(item);
		else if (
			item !== null &&
			typeof item === 'object' &&
			(item as { isExpression?: unknown }).isExpression !== true &&
			typeof (item as { value?: unknown }).value === 'string'
		) {
			names.push((item as { value: string }).value);
		} else return null;
	}
	return names;
}

/**
 * Rewrites a column name inside an index's or constraint's column list, whichever shape it takes.
 *
 * @param entity - The entity.
 * @param field - The list field (`columns`, `columnsTo`).
 * @param from - The old name.
 * @param to - The new name.
 * @returns The entity with the name replaced, or unchanged when the field does not hold it.
 */
function renameInList(entity: Entity, field: string, from: string, to: string): Entity {
	const list = entity[field];
	if (!Array.isArray(list)) return entity;
	let touched = false;
	const renamed = list.map((item) => {
		if (item === from) {
			touched = true;
			return to;
		}
		if (item !== null && typeof item === 'object' && (item as { value?: unknown }).value === from) {
			touched = true;
			return { ...(item as Record<string, unknown>), value: to };
		}
		return item;
	});
	return touched ? { ...entity, [field]: renamed } : entity;
}

/**
 * Whether an entity sits in the schema a rename names (the default when the rename names none).
 *
 * @param entity - The entity.
 * @param schema - The rename's schema.
 * @returns Whether they match.
 */
function inSchema(entity: Entity, schema: string | undefined): boolean {
	return schemaOf(entity) === (schema ?? DEFAULT_SCHEMA);
}

/**
 * Whether a foreign key points into the schema a rename names. A foreign key carries the schema it
 * points at separately (`schemaTo`); absent, it points into its own.
 *
 * @param entity - The foreign key entity.
 * @param schema - The rename's schema.
 * @returns Whether the target matches.
 */
function pointsIntoSchema(entity: Entity, schema: string | undefined): boolean {
	return (text(entity, 'schemaTo') ?? schemaOf(entity)) === (schema ?? DEFAULT_SCHEMA);
}

/**
 * Applies one table rename to the parent snapshot: the table entity takes its new name, and every
 * entity that belonged to it, or pointed at it, follows.
 *
 * @param entities - The parent snapshot's entities.
 * @param rename - The table rename.
 * @returns The entities as they would read had the table always had its new name.
 */
function applyTableRename(entities: readonly Entity[], rename: TableRename): Entity[] {
	return entities.map((entity) => {
		let renamed = entity;
		if (inSchema(entity, rename.schema)) {
			if (entity.entityType === 'tables' && entity['name'] === rename.from) {
				renamed = { ...renamed, name: rename.to };
			}
			if (renamed['table'] === rename.from) renamed = { ...renamed, table: rename.to };
		}
		if (pointsIntoSchema(entity, rename.schema) && renamed['tableTo'] === rename.from) {
			renamed = { ...renamed, tableTo: rename.to };
		}
		return renamed;
	});
}

/**
 * Applies one column rename to the parent snapshot: the column entity takes its new name, and the
 * constraints and indexes that list it follow.
 *
 * @param entities - The parent snapshot's entities, table renames already applied.
 * @param rename - The column rename.
 * @returns The entities as they would read had the column always had its new name.
 */
function applyColumnRename(entities: readonly Entity[], rename: ColumnRename): Entity[] {
	return entities.map((entity) => {
		let renamed = entity;
		if (inSchema(entity, rename.schema) && entity['table'] === rename.table) {
			if (entity.entityType === 'columns' && entity['name'] === rename.from) {
				return { ...entity, name: rename.to };
			}
			renamed = renameInList(renamed, 'columns', rename.from, rename.to);
		}
		// A foreign key may point at the renamed column — from another table, or from its own.
		if (pointsIntoSchema(entity, rename.schema) && entity['tableTo'] === rename.table) {
			renamed = renameInList(renamed, 'columnsTo', rename.from, rename.to);
		}
		return renamed;
	});
}

/**
 * Rewrites the parent snapshot so every rename the resolver answered reads as the same entity under
 * its new name. Without this, a renamed table's columns compare as dropped and created — which is
 * how a column drop hiding beside a table rename once went unmeasured.
 *
 * @param parent - The parent snapshot's entities.
 * @param renames - The resolved renames.
 * @returns The parent, renamed.
 */
function applyRenames(parent: readonly Entity[], renames: Renames): readonly Entity[] {
	let entities = parent;
	for (const rename of renames.tables) entities = applyTableRename(entities, rename);
	for (const rename of renames.columns) entities = applyColumnRename(entities, rename);
	return entities;
}

/**
 * Builds the live-name lookup from the renames: every rename maps a new name back to the one the
 * database still has.
 *
 * @param renames - The resolved renames.
 * @returns The lookup.
 */
function liveNames(renames: Renames): LiveNames {
	const tables = new Map(
		renames.tables.map((rename) => [
			tableIdentity(rename.schema ?? DEFAULT_SCHEMA, rename.to),
			rename.from,
		]),
	);
	const columns = new Map(
		renames.columns.map((rename) => [
			columnIdentity(rename.schema ?? DEFAULT_SCHEMA, rename.table, rename.to),
			rename.from,
		]),
	);
	return {
		table: (schema, name) => tables.get(tableIdentity(schema, name)) ?? name,
		column: (schema, table, name) => columns.get(columnIdentity(schema, table, name)) ?? name,
	};
}

/**
 * Diffs the two snapshots by entity identity.
 *
 * @param parent - The parent snapshot's entities, renames applied.
 * @param next - The new snapshot's entities.
 * @returns One difference per entity that appeared, disappeared or changed, in snapshot order.
 */
function diffEntities(parent: readonly Entity[], next: readonly Entity[]): Difference[] {
	const before = new Map(parent.map((entity) => [identityOf(entity), entity]));
	const after = new Map(next.map((entity) => [identityOf(entity), entity]));
	const differences: Difference[] = [];

	for (const [key, entity] of before) {
		const counterpart = after.get(key);
		if (counterpart === undefined) {
			differences.push({
				op: 'drop',
				before: entity,
				after: undefined,
				operation: describe(entity, 'drop'),
			});
			continue;
		}
		const changed = changedFields(entity, counterpart);
		if (changed.length > 0) {
			differences.push({
				op: 'alter',
				before: entity,
				after: counterpart,
				operation: {
					...describe(counterpart, 'alter'),
					changed,
					detail: describeAlter(entity, counterpart, changed),
				},
			});
		}
	}
	for (const [key, entity] of after) {
		if (!before.has(key)) {
			differences.push({
				op: 'create',
				before: undefined,
				after: entity,
				operation: describe(entity, 'create'),
			});
		}
	}
	return differences;
}

/**
 * The descriptive fields that differ between two versions of one entity.
 *
 * @param before - The parent's version.
 * @param after - The new version.
 * @returns The changed field names.
 */
function changedFields(before: Entity, after: Entity): string[] {
	const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
	return [...fields].filter(
		(field) => !IDENTITY_FIELDS.has(field) && canonical(before[field]) !== canonical(after[field]),
	);
}

/**
 * Says what an alter changed, field by field, so a person deciding sees before and after. A type
 * change alone reads as `numeric(10,4) → numeric(10,2)`; anything else names the field.
 *
 * @param before - The parent's version.
 * @param after - The new version.
 * @param changed - The changed fields.
 * @returns The description.
 */
function describeAlter(before: Entity, after: Entity, changed: readonly string[]): string {
	return changed
		.map((field) => {
			const change = `${show(before[field])} → ${show(after[field])}`;
			return field === 'type' ? change : `${field}: ${change}`;
		})
		.join('; ');
}

/**
 * Builds the operation record for an entity.
 *
 * @param entity - The entity.
 * @param op - What happened to it.
 * @returns The operation.
 */
function describe(entity: Entity, op: OperationKind): Operation {
	const table = text(entity, 'table');
	return {
		entityType: entity.entityType,
		op,
		schema: schemaOf(entity),
		...(table === undefined ? {} : { table }),
		name: text(entity, 'name') ?? '',
	};
}

/**
 * The character-length bound of a string column type: a finite cap for a bounded type (`varchar(n)`,
 * `char(n)`, SQLite's `text(n)`), `Infinity` for an unbounded string type (`text`, bare `varchar`),
 * or `null` for a non-string type. Treating `text` as `Infinity` is what lets a `text → varchar(n)`
 * narrowing count.
 *
 * @param type - The column's SQL type string from the snapshot.
 * @returns The max length (possibly `Infinity`), or `null` when the type is not string-like.
 */
export function stringMaxLength(type: string): number | null {
	const normalized = type.trim().toLowerCase();
	const bounded =
		/^(?:varchar|character varying|char|character|nvarchar|nchar|text)\((\d+)\)$/.exec(normalized);
	if (bounded) return Number(bounded[1]);
	if (/^(?:varchar|character varying|char|character|nvarchar|nchar|text|clob)$/.test(normalized)) {
		return Number.POSITIVE_INFINITY;
	}
	return null;
}

/**
 * The identifiers a measurement needs for a column, in live names.
 *
 * @param entity - A column entity from the new snapshot (or the parent, for a drop).
 * @param live - The live-name lookup.
 * @returns The schema (absent on SQLite), the live table name and the live column name.
 */
function measured(
	entity: Entity,
	live: LiveNames,
): { schema?: string; table: string; column: string } {
	const schema = text(entity, 'schema');
	const namespace = schema ?? DEFAULT_SCHEMA;
	const newTable = text(entity, 'table') ?? '';
	return {
		...(schema === undefined ? {} : { schema }),
		table: live.table(namespace, newTable),
		column: live.column(namespace, newTable, text(entity, 'name') ?? ''),
	};
}

/**
 * Sorts a change of column type. A string type that grows or loses its bound destroys nothing; one
 * that shrinks must be measured; anything else — a numeric precision, an integer width, a family
 * change — has no rule here and waits. That last case is the `numeric(10,4) → numeric(10,2)` lesson.
 *
 * @param from - The parent's type.
 * @param to - The new type.
 * @param target - The column, in live names.
 * @returns The verdict.
 */
function sortTypeChange(
	from: string,
	to: string,
	target: { schema?: string; table: string; column: string },
): Verdict {
	const beforeMax = stringMaxLength(from);
	const afterMax = stringMaxLength(to);
	if (beforeMax === null || afterMax === null) return 'unclassified';
	if (afterMax < beforeMax) return [{ kind: 'narrow_column', ...target, maxLength: afterMax }];
	return 'additive';
}

/**
 * Sorts an altered column, field by field. The worst verdict wins, and the measurements are kept
 * alongside an unclassified verdict so the person deciding still sees the counts.
 *
 * @param before - The parent's column.
 * @param after - The new column.
 * @param changed - The fields that differ.
 * @param live - The live-name lookup, for the measurements.
 * @returns The verdicts, one per changed field.
 */
function sortColumnAlter(
	before: Entity,
	after: Entity,
	changed: readonly string[],
	live: LiveNames,
): Verdict[] {
	const target = measured(after, live);
	return changed.map((field) => {
		switch (field) {
			case 'notNull':
				return after['notNull'] === true ? [{ kind: 'set_not_null', ...target }] : 'additive';
			case 'default':
				return 'additive';
			case 'type': {
				// An array column's length lives inside its elements; nothing here measures that.
				const dimensions = after['dimensions'] ?? before['dimensions'];
				if (typeof dimensions === 'number' && dimensions > 0) return 'unclassified';
				return sortTypeChange(text(before, 'type') ?? '', text(after, 'type') ?? '', target);
			}
			default:
				return 'unclassified';
		}
	});
}

/**
 * Sorts a new column. It is additive unless the database would have to invent a value for existing
 * rows and cannot: required, no default, and not a type the database fills itself (an identity or
 * serial column). A required **generated** column is unclassified: the database computes it, but
 * nothing here can tell whether the expression yields a value for every existing row.
 *
 * @param entity - The column entity.
 * @param live - The live-name lookup, for the measurement.
 * @returns The verdict.
 */
function sortNewColumn(entity: Entity, live: LiveNames): Verdict {
	const required = entity['notNull'] === true && entity['default'] == null;
	if (!required) return 'additive';
	if (entity['generated'] != null) return 'unclassified';
	const selfFilling =
		entity['identity'] != null || SELF_FILLING_TYPES.test(text(entity, 'type') ?? '');
	if (selfFilling) return 'additive';
	const { column, ...target } = measured(entity, live);
	return [{ kind: 'add_not_null_column', ...target, column, hasDefault: false }];
}

/**
 * Sorts a created index or unique constraint. Uniqueness over a single existing column is measured
 * for duplicates; over columns created in the same change it is additive when they arrive empty
 * (NULL is never a duplicate) and unclassified when one arrives with a default, which every existing
 * row would share; over several columns, an expression, or with a `where` clause nothing measures it
 * yet. A plain index touches no values.
 *
 * @param entity - The index or unique entity.
 * @param unique - Whether it enforces uniqueness.
 * @param context - What is known about the change as a whole.
 * @returns The verdict.
 */
function sortUniqueness(entity: Entity, unique: boolean, context: Context): Verdict {
	if (!unique) return 'additive';
	const columns = coveredColumns(entity);
	if (columns === null || columns.length === 0) return 'unclassified';

	const schema = text(entity, 'schema');
	const namespace = schema ?? DEFAULT_SCHEMA;
	const newTable = text(entity, 'table') ?? '';
	const created = columns.map((column) =>
		context.createdColumns.get(columnIdentity(namespace, newTable, column)),
	);
	if (created.every((column) => column !== undefined)) {
		return created.some((column) => column['default'] != null) ? 'unclassified' : 'additive';
	}
	if (columns.length !== 1 || entity['where'] != null) return 'unclassified';

	const column = columns[0] as string;
	return [
		{
			kind: 'add_unique',
			...(schema === undefined ? {} : { schema }),
			table: context.live.table(namespace, newTable),
			column: context.live.column(namespace, newTable, column),
			...(entity['nullsNotDistinct'] === true ? { nullsNotDistinct: true } : {}),
		},
	];
}

/**
 * The rule table. Anything not named here is unclassified.
 *
 * @param difference - One entity's difference.
 * @param context - What is known about the change as a whole.
 * @returns The verdicts for this difference (several only for a column altered in several ways).
 */
function sort(difference: Difference, context: Context): Verdict[] {
	const { op, before, after } = difference;
	const entity = (after ?? before) as Entity;
	const { entityType } = entity;
	const owner = ownerOf(entity);

	// Everything under a table that is itself created or dropped is part of that operation.
	if (entityType !== 'tables' && owner !== undefined) {
		if (op === 'create' && context.createdTables.has(owner)) return ['covered'];
		if (op === 'drop' && context.droppedTables.has(owner)) return ['covered'];
	}

	if (entityType === 'tables') {
		if (op === 'create') return ['additive'];
		if (op === 'drop') {
			const schema = text(entity, 'schema');
			return [
				[
					{
						kind: 'drop_table',
						...(schema === undefined ? {} : { schema }),
						table: text(entity, 'name') ?? '',
					},
				],
			];
		}
		return ['unclassified'];
	}

	if (entityType === 'columns') {
		if (op === 'create') return [sortNewColumn(entity, context.live)];
		if (op === 'drop') {
			// A generated column stores nothing of its own; dropping it loses nothing.
			if (entity['generated'] != null) return ['additive'];
			return [[{ kind: 'drop_column', ...measured(entity, context.live) }]];
		}
		return sortColumnAlter(
			before as Entity,
			after as Entity,
			difference.operation.changed ?? [],
			context.live,
		);
	}

	if (entityType === 'indexes') {
		if (op === 'drop') return ['additive'];
		return [sortUniqueness(entity, entity['isUnique'] === true, context)];
	}
	if (entityType === 'uniques') {
		if (op === 'drop') return ['additive'];
		if (op === 'create') return [sortUniqueness(entity, true, context)];
		return ['unclassified'];
	}

	if (op === 'create' && ADDITIVE_WHEN_CREATED.has(entityType)) return ['additive'];
	if (op === 'create' && UNCLASSIFIED_WHEN_CREATED.has(entityType)) return ['unclassified'];
	if (op === 'drop' && ADDITIVE_WHEN_DROPPED.has(entityType)) return ['additive'];
	return ['unclassified'];
}

/**
 * The one operation that stands for a parent snapshot the classifier could not read. Not knowing what
 * a change is relative to is not knowing what the change is.
 *
 * @param detail - Why the parent could not be read.
 * @returns The unclassified operation.
 */
export function unreadableParent(detail: string): Operation {
	return { entityType: 'snapshot', op: 'alter', schema: DEFAULT_SCHEMA, name: 'parent', detail };
}

/**
 * Collects the identities of the entities of one type that exist only in `next`.
 *
 * @param parent - The parent's entities, renames applied.
 * @param next - The new entities.
 * @param entityType - The entity type to compare.
 * @param identity - How to key an entity of that type.
 * @returns The keys of the created entities, and of the dropped ones.
 */
function createdAndDropped(
	parent: readonly Entity[],
	next: readonly Entity[],
	entityType: string,
	identity: (entity: Entity) => string | undefined,
): { created: Set<string>; dropped: Set<string> } {
	const keysOf = (entities: readonly Entity[]): Set<string> =>
		new Set(
			entities
				.filter((entity) => entity.entityType === entityType)
				.map(identity)
				.filter((key): key is string => key !== undefined),
		);
	const before = keysOf(parent);
	const after = keysOf(next);
	return {
		created: new Set([...after].filter((key) => !before.has(key))),
		dropped: new Set([...before].filter((key) => !after.has(key))),
	};
}

/**
 * Classifies the change between a parent snapshot and the new one.
 *
 * @param parent - The parent snapshot's `ddl` entities (empty for a first migration).
 * @param next - The new snapshot's `ddl` entities.
 * @param renames - The renames the resolver answered.
 * @returns Every operation, sorted into additive, destructive (to be measured) or unclassified.
 */
export function classifyChange(
	parent: readonly Entity[],
	next: readonly Entity[],
	renames: Renames = { tables: [], columns: [] },
): Classification {
	const renamedParent = applyRenames(parent, renames);
	const tables = createdAndDropped(renamedParent, next, 'tables', ownerOf);
	const columnKey = (entity: Entity): string | undefined => {
		const table = text(entity, 'table');
		const name = text(entity, 'name');
		return table === undefined || name === undefined
			? undefined
			: columnIdentity(schemaOf(entity), table, name);
	};
	const columns = createdAndDropped(renamedParent, next, 'columns', columnKey);
	const createdColumns = new Map<string, Entity>();
	for (const entity of next) {
		const key = entity.entityType === 'columns' ? columnKey(entity) : undefined;
		if (key !== undefined && columns.created.has(key)) createdColumns.set(key, entity);
	}
	const context: Context = {
		createdTables: tables.created,
		droppedTables: tables.dropped,
		createdColumns,
		live: liveNames(renames),
	};

	const additive: Operation[] = [];
	const destructive: UnsafeChange[] = [];
	const unclassified: Operation[] = [];

	for (const difference of diffEntities(renamedParent, next)) {
		const verdicts = sort(difference, context);
		let waits = false;
		let measures = false;
		for (const verdict of verdicts) {
			if (verdict === 'unclassified') waits = true;
			else if (Array.isArray(verdict)) {
				destructive.push(...verdict);
				measures = true;
			}
		}
		if (waits) unclassified.push(difference.operation);
		else if (!measures && verdicts.some((verdict) => verdict === 'additive')) {
			additive.push(difference.operation);
		}
	}

	return { additive, destructive, unclassified };
}
