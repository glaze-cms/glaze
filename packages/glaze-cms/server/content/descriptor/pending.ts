/**
 * Marking the descriptor with what is on file. The model itself is described once, from the schema;
 * what an open approval request would remove changes between boots and decisions, so it is laid over
 * the model when it is served rather than baked into it.
 */

import type { ContentModel, EntityDescriptor, FieldDescriptor } from './types.ts';

/** The columns and tables open approval requests would drop. */
export interface PendingDrops {
	/** Table names an open request would drop. */
	readonly tables: ReadonlySet<string>;
	/** Columns an open request would drop, keyed by {@link columnKey}. */
	readonly columns: ReadonlySet<string>;
}

/** Nothing pending. */
export const NO_PENDING_DROPS: PendingDrops = { tables: new Set(), columns: new Set() };

/**
 * The key a pending column drop is filed under: table and column, NUL-separated so identifiers with
 * spaces cannot collide.
 *
 * @param table - The table name.
 * @param column - The database column name.
 * @returns The key.
 */
export function columnKey(table: string, column: string): string {
	return `${table}\0${column}`;
}

/**
 * Marks a field `pending: 'drop'` when an open request would remove its column. A field with no
 * column of its own (a many-to-many relation) has nothing to drop.
 *
 * @param field - The field.
 * @param table - The owning table.
 * @param pending - What is on file.
 * @returns The field, marked when it needs to be.
 */
function markField(field: FieldDescriptor, table: string, pending: PendingDrops): FieldDescriptor {
	if (field.kind !== 'field' || field.column === null) return field;
	return pending.columns.has(columnKey(table, field.column))
		? { ...field, pending: 'drop' }
		: field;
}

/**
 * Marks an entity, and its fields, with what an open request would remove.
 *
 * @param entity - The entity.
 * @param pending - What is on file.
 * @returns The entity, marked where it needs to be.
 */
function markEntity(entity: EntityDescriptor, pending: PendingDrops): EntityDescriptor {
	return {
		...entity,
		pending: pending.tables.has(entity.name) ? 'drop' : null,
		fields: entity.fields.map((field) => markField(field, entity.name, pending)),
	};
}

/**
 * Lays what is on file over the content model, so the admin can show a column or an entity as on
 * its way out. The database still has them and they are still served: the change has not happened.
 *
 * @param model - The content model, as described from the schema.
 * @param pending - The columns and tables open requests would drop.
 * @returns The model with `pending` set where a request names the column or entity.
 */
export function markPendingDrops(model: ContentModel, pending: PendingDrops): ContentModel {
	if (pending.tables.size === 0 && pending.columns.size === 0) return model;
	return { entities: model.entities.map((entity) => markEntity(entity, pending)) };
}
