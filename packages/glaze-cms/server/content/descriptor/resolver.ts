/**
 * Builds the content-model descriptor the Admin UI renders from.
 *
 * Reads top-down: partition junction tables out of the entity list, then describe each surviving
 * entity — its fields, the relations recovered from consumed junctions, and the presentation keys
 * that today are inferred.
 *
 * The signature takes presentation as a parameter it does not yet receive. That is deliberate: when
 * stored presentation metadata exists it changes how `label`, `description`, `displayField` and
 * `fieldType` RESOLVE, and changes nothing about the shape emitted here or the Admin UI reading it.
 */

import {
	humanise,
	inferDisplayField,
	inferFieldConfig,
	inferFieldType,
	pkKey,
	readDataType,
} from './inference.ts';
import { partitionJunctions } from './junctions.ts';

import type { Entity } from '../types.ts';
import type { DerivedRelation } from './junctions.ts';
import type {
	EntityCapabilities,
	EntityDescriptor,
	DataTypeInfo,
	FieldDescriptor,
	FieldNode,
	RelationTarget,
	ContentModel,
} from './types.ts';
import type { Column } from 'drizzle-orm';

/**
 * Which routes an entity serves. Mirrors the content router's registration rule — a table without a
 * single-column primary key has no way to address one row, so it serves list + create only. Stated by
 * the server rather than re-derived by clients, and the place role- or config-based restrictions will
 * land without changing the contract.
 *
 * @param entity - The entity.
 * @returns Its capabilities.
 */
function describeCapabilities(entity: Entity): EntityCapabilities {
	const hasPk = entity.pk !== undefined;
	return { byId: hasPk, create: true, update: hasPk, delete: hasPk };
}

/**
 * Describes a relation stored as a foreign key on this table — a to-one link.
 *
 * @param reference - The column's foreign key.
 * @param targets - Every described entity, keyed by name, for resolving the target's property name.
 * @returns The relation target, writable because the owning column is written like any other.
 */
function describeForeignKeyRelation(
	reference: { entity: string; column: string },
	targets: TargetIndex,
): RelationTarget {
	return {
		entity: reference.entity,
		column: resolveTargetProperty(reference, targets),
		cardinality: 'one',
		displayField: null,
		writable: true,
	};
}

/**
 * Every entity's column map, keyed by entity name — what a relation needs to translate a
 * database column name back into the property name callers actually address.
 */
type TargetIndex = ReadonlyMap<string, Entity>;

/**
 * Translates a foreign key's target column from its DATABASE name to its PROPERTY name.
 *
 * Drizzle's foreign-key metadata reports the database column, but every other name in this descriptor —
 * `primaryKey`, `displayField`, `FieldNode.name`, `defaultSort.field` — is a property name, and the list
 * endpoint resolves filters by property. Emitting the database name here would make relation pickers
 * unusable on any schema where the two differ, which is the ordinary `camelCase`/`snake_case` case:
 * `GET /api/authors?filter[author_key]=5` is rejected as an unknown field.
 *
 * @param reference - The foreign key.
 * @param targets - Every described entity, keyed by name.
 * @returns The target's property name, falling back to the database name when the target is unknown.
 */
function resolveTargetProperty(
	reference: { entity: string; column: string },
	targets: TargetIndex,
): string {
	const target = targets.get(reference.entity);
	if (!target) return reference.column;
	for (const [property, column] of Object.entries(target.columns)) {
		if (column.name === reference.column) return property;
	}
	return reference.column;
}

/**
 * Describes a relation recovered from a junction table — a to-many link.
 *
 * Marked read-only: writing it means inserting and deleting junction rows, and that path does not exist
 * yet. The Admin UI should show the linked entries without offering to change them.
 *
 * @param relation - The derived relation.
 * @returns The relation target.
 */
function describeDerivedRelation(relation: DerivedRelation, targets: TargetIndex): RelationTarget {
	return {
		entity: relation.entity,
		column: resolveTargetProperty(relation, targets),
		cardinality: relation.cardinality,
		displayField: null,
		writable: false,
	};
}

/**
 * Reports a column's storage type as parsed halves rather than Drizzle's raw compound string, which is
 * an ORM internal and differs across dialects for the same logical column.
 *
 * @param column - The Drizzle column.
 * @returns The category and refinement.
 */
function describeDataType(column: Column): DataTypeInfo {
	const { category, constraint } = readDataType(column);
	return { category, constraint: constraint ?? null };
}

/**
 * Describes one column as a field node.
 *
 * @param name - The column's property name.
 * @param column - The Drizzle column.
 * @param entity - The entity it belongs to.
 * @returns The field node.
 */
function describeField(
	name: string,
	column: Column,
	entity: Entity,
	targets: TargetIndex,
): FieldNode {
	const reference = entity.references[name];
	const fieldType = inferFieldType(column, reference);

	return {
		kind: 'field',
		name,
		column: column.name,
		dataType: describeDataType(column),
		isPrimaryKey: name === pkKey(entity),
		fieldType,
		fieldTypeSource: 'inferred',
		label: humanise(name),
		description: null,
		relation: reference ? describeForeignKeyRelation(reference, targets) : null,
		config: inferFieldConfig(column),
		pending: null,
	};
}

/**
 * Describes a many-to-many relation as a field node. It has no column of its own — the link lives in
 * the junction table — so the storage-derived config is uniformly empty.
 *
 * @param relation - The derived relation.
 * @returns The field node.
 */
function describeRelationField(
	relation: DerivedRelation,
	name: string,
	targets: TargetIndex,
): FieldNode {
	return {
		kind: 'field',
		name,
		// A many-to-many relation has no column of its own — the link lives in the junction table.
		column: null,
		dataType: null,
		isPrimaryKey: false,
		fieldType: 'relation',
		fieldTypeSource: 'inferred',
		label: humanise(name),
		description: null,
		relation: describeDerivedRelation(relation, targets),
		config: {
			required: false,
			maxLength: null,
			decimalAllowed: false,
			timezone: false,
			hasDefault: false,
			defaultValue: null,
			options: [],
			colorFormat: null,
			allowedTypes: [],
			previewSize: null,
		},
		pending: null,
	};
}

/**
 * Describes one entity: its columns as fields, followed by any relations recovered from junction
 * tables. The tree is flat today — groups come from presentation metadata, which does not exist yet.
 *
 * @param entity - The entity to describe.
 * @param relations - Many-to-many relations belonging to it.
 * @returns The entity descriptor.
 */
export function describeEntity(
	entity: Entity,
	relations: readonly DerivedRelation[] = [],
	targets: TargetIndex = new Map(),
): EntityDescriptor {
	const fields: FieldDescriptor[] = Object.entries(entity.columns).map(([name, column]) =>
		describeField(name, column, entity, targets),
	);

	const taken = new Set(fields.map((field) => field.name));
	for (const relation of relations) {
		const name = uniqueRelationName(relation, taken);
		taken.add(name);
		fields.push(describeRelationField(relation, name, targets));
	}

	const primaryKey = pkKey(entity) ?? null;
	const displayField = inferDisplayField(entity);

	return {
		name: entity.name,
		// Reserved: nothing in DDL says a table is meant to hold exactly one row.
		kind: 'multiple',
		label: humanise(entity.name),
		description: null,
		primaryKey,
		displayField,
		// Ordering must be deterministic for `limit`/`offset` paging, so it falls back to the key.
		defaultSort: primaryKey ? { field: primaryKey, direction: 'asc' } : null,
		draftPublish: false,
		capabilities: describeCapabilities(entity),
		fields,
		pending: null,
	};
}

/**
 * Describes the whole content model.
 *
 * @param entities - The servable entities, junction tables included.
 * @returns The schema descriptor, with pure junction tables consumed into relation fields.
 */
export function describeContentModel(entities: readonly Entity[]): ContentModel {
	const { entities: served, relations } = partitionJunctions(entities);
	const targets: TargetIndex = new Map(served.map((entity) => [entity.name, entity]));

	return {
		entities: served.map((entity) =>
			describeEntity(entity, servableRelations(entity, relations, targets), targets),
		),
	};
}

/**
 * An entity's derived relations, minus any whose target is not itself served.
 *
 * A junction survives its target being dropped — excluded via `content.exclude`, or skipped for an
 * unsafe name — and would otherwise leave a relation field pointing at an entity with no descriptor
 * entry and no routes, so the Admin UI renders a picker that can only 404.
 *
 * @param entity - The entity being described.
 * @param relations - Every derived relation, keyed by owning entity.
 * @param targets - The entities actually being served.
 * @returns The relations whose target is reachable.
 */
function servableRelations(
	entity: Entity,
	relations: ReadonlyMap<string, readonly DerivedRelation[]>,
	targets: TargetIndex,
): DerivedRelation[] {
	return (relations.get(entity.name) ?? []).filter((relation) => targets.has(relation.entity));
}

/**
 * Picks a field name for a derived relation that is not already used on the entity.
 *
 * A relation is named after the entity it points at, which collides in three real cases: a
 * self-referential junction (both sides name the same entity), two junctions over the same pair,
 * and a target whose name matches an existing column. Duplicated names are worse than ugly ones — the
 * field list is what the Admin UI keys form state and React children by, so a duplicate silently drops
 * one of them. The junction column that produced the relation is the only thing distinguishing them, so
 * it is what disambiguates.
 *
 * @param relation - The derived relation.
 * @param taken - Names already used on this entity.
 * @returns An unused field name, deterministic for a given schema.
 */
function uniqueRelationName(relation: DerivedRelation, taken: ReadonlySet<string>): string {
	if (!taken.has(relation.name)) return relation.name;

	const qualified = `${relation.name}_${relation.viaColumn}`;
	if (!taken.has(qualified)) return qualified;

	// Two junctions with identically-named columns over the same pair: fall back to the table itself.
	let candidate = `${qualified}_${relation.via}`;
	let suffix = 2;
	while (taken.has(candidate)) candidate = `${qualified}_${relation.via}_${suffix++}`;
	return candidate;
}
