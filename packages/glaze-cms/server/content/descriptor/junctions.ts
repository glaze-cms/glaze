/**
 * Separates pure junction tables from real entities.
 *
 * A junction table is not a content type — it is how a many-to-many relationship is stored. `post_tags`
 * is how `posts.tags` is stored. But it is not ignorable either: it is the only evidence that two
 * entities are related at all. So it is **consumed** — read to derive a `relation` field on both
 * sides — and then dropped, so an editor never sees "Post Tags" in the sidebar.
 *
 * Detection errs toward showing. A table is consumed only when its composite primary key is made
 * entirely of foreign keys and it carries no data of its own, because a false positive would silently
 * remove a real content type from the Admin UI. A junction with payload — `post_authors.role` — holds
 * content an editor may need, so it stays a visible entity.
 */

import type { Entity } from '../types.ts';
import type { RelationCardinality } from './types.ts';

/** A many-to-many relation recovered from a junction table. */
export interface DerivedRelation {
	/** The field name to expose it under — the target entity's name. */
	readonly name: string;
	/** The entity on the other side. */
	readonly entity: string;
	/** The column joined on in that entity. */
	readonly column: string;
	/** Always `many`: a junction exists precisely because the relationship is many-to-many. */
	readonly cardinality: RelationCardinality;
	/** The junction table this was recovered from, for diagnostics. */
	readonly via: string;
	/**
	 * The junction column pointing at the target. The only thing that distinguishes two relations to the
	 * same entity — a self-referential junction, or two junctions over one pair — so it is what a
	 * colliding field name is disambiguated with.
	 */
	readonly viaColumn: string;
}

/** The result of partitioning: the entities to serve, and the relations recovered from the rest. */
export interface Partitioned {
	/** Entities the API serves — everything that is not a consumed junction. */
	readonly entities: readonly Entity[];
	/** Derived relations, keyed by the entity they belong to. */
	readonly relations: ReadonlyMap<string, readonly DerivedRelation[]>;
}

/**
 * Whether an entity is a pure junction table: a composite primary key made entirely of foreign keys,
 * and **nothing else at all**.
 *
 * The "nothing else" is strict on purpose. An earlier rule tolerated any defaulted date column as
 * bookkeeping, which swallowed real content: a `subscriptions(user_id, plan_id, starts_at DEFAULT now())`
 * table has a composite FK key and a defaulted date, yet `starts_at` is the subscription period — data an
 * editor owns. Consuming that table removes it from the Admin UI entirely, with no error and no log.
 *
 * The cost of strictness is noise, not loss: a junction carrying `created_at` stays visible as a
 * entity. That is the right way round, and the presentation layer's `hidden` flag is the escape
 * hatch for tidying it away deliberately.
 *
 * @param entity - The entity to classify.
 * @returns `true` when the table records only which rows are linked.
 */
function isPureJunction(entity: Entity): boolean {
	const keys = entity.primaryKeyColumns;
	// A single-column key addresses one entity; a junction links two or more.
	if (keys.length < 2) return false;
	if (!keys.every((key) => entity.references[key])) return false;

	return Object.keys(entity.columns).every((key) => keys.includes(key));
}

/**
 * Derives the two relations a junction records, one for each side.
 *
 * Only a two-column key produces relations: a key spanning three or more tables is not a simple
 * many-to-many and has no faithful field representation, so its table is kept as an entity instead.
 *
 * @param junction - An entity already known to be a pure junction.
 * @returns The relation for each side keyed by the entity that owns it, or `undefined` when the
 * junction is not a two-way link.
 */
function deriveRelations(
	junction: Entity,
): { owner: string; relation: DerivedRelation }[] | undefined {
	const [firstKey, secondKey, ...rest] = junction.primaryKeyColumns;
	if (!firstKey || !secondKey || rest.length > 0) return undefined;

	const first = junction.references[firstKey];
	const second = junction.references[secondKey];
	if (!first || !second) return undefined;

	return [
		{
			owner: first.entity,
			relation: {
				name: second.entity,
				entity: second.entity,
				column: second.column,
				cardinality: 'many',
				via: junction.name,
				viaColumn: secondKey,
			},
		},
		{
			owner: second.entity,
			relation: {
				name: first.entity,
				entity: first.entity,
				column: first.column,
				cardinality: 'many',
				via: junction.name,
				viaColumn: firstKey,
			},
		},
	];
}

/**
 * Partitions entities into those the API serves and the many-to-many relations recovered from the
 * junction tables among them.
 *
 * @param entities - Every loaded entity.
 * @returns The servable entities plus the relations derived from the consumed ones.
 */
export function partitionJunctions(entities: readonly Entity[]): Partitioned {
	const served: Entity[] = [];
	const relations = new Map<string, DerivedRelation[]>();

	for (const entity of entities) {
		const derived = isPureJunction(entity) ? deriveRelations(entity) : undefined;
		if (!derived) {
			served.push(entity);
			continue;
		}

		for (const { owner, relation } of derived) {
			const existing = relations.get(owner) ?? [];
			existing.push(relation);
			relations.set(owner, existing);
		}
	}

	return { entities: served, relations };
}
