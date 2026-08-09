/**
 * Per-collection TypeBox request schemas, generated from the Drizzle table's columns so validation
 * tracks the schema automatically (no hand-authored, drift-prone schemas per collection).
 *
 * Schemas are built with Elysia's OWN TypeBox instance (`t`), so they share its Kind registry — a schema
 * built by a different TypeBox copy is silently ignored by Elysia's validator (routes then run
 * unvalidated). A generic column→`t` mapper is used rather than `drizzle-orm/typebox`: that generator is
 * pinned to a TypeBox major line that Elysia's bundled TypeBox does not match, so its schemas would not
 * share the registry. Keep the mapper if you ever revisit `drizzle-orm/typebox` — swapping back is a
 * change local to this file.
 */

import { t } from 'elysia';

import type { Collection } from './types.ts';
import type { Column } from 'drizzle-orm';
import type { AnySchema } from 'elysia';

/** The request schemas for a collection. */
export interface CollectionSchemas {
	/** POST body — NOT-NULL columns without a default are required; defaulted/generated ones optional. */
	readonly body: AnySchema;
	/** PATCH body — every column optional, with the primary key removed (it can never be reassigned). */
	readonly update: AnySchema;
}

/**
 * Maps a Drizzle column's JS-level data type to a TypeBox schema. Exotic types (date/json/buffer/…) fall
 * back to `t.Unknown()` — the property still participates in the object shape (so unknown fields are
 * stripped), while the database remains the arbiter of the value.
 *
 * @param column - The Drizzle column.
 * @returns The TypeBox schema for the column's value.
 */
function columnSchema(column: Column): AnySchema {
	switch (column.dataType) {
		case 'string':
			return t.String();
		case 'number':
			return t.Number();
		case 'boolean':
			return t.Boolean();
		case 'bigint':
			return t.Integer();
		default:
			return t.Unknown();
	}
}

/**
 * Whether a column is optional in an insert body: a column with a default (or generated) value, or a
 * nullable one, need not be supplied.
 *
 * @param column - The Drizzle column.
 * @returns `true` when the column may be omitted from a create request.
 */
function isInsertOptional(column: Column): boolean {
	return column.hasDefault || !column.notNull;
}

/**
 * Builds the create/update request schemas for a collection.
 *
 * @param collection - The collection to derive schemas from.
 * @returns Its {@link CollectionSchemas}.
 */
export function buildCollectionSchemas(collection: Collection): CollectionSchemas {
	const pkKey = pkPropertyName(collection);
	const insertShape: Record<string, AnySchema> = {};
	const updateShape: Record<string, AnySchema> = {};

	for (const [key, column] of Object.entries(collection.columns)) {
		const schema = columnSchema(column);
		insertShape[key] = isInsertOptional(column) ? t.Optional(schema) : schema;
		// The PK is never reassignable, so it is absent from the (all-optional) update body.
		if (key !== pkKey) updateShape[key] = t.Optional(schema);
	}

	return { body: t.Object(insertShape), update: t.Object(updateShape) };
}

/**
 * Finds the property-name key of a collection's primary-key column.
 *
 * @param collection - The target collection.
 * @returns The PK's property key, or `undefined` when there is no single-column PK.
 */
function pkPropertyName(collection: Collection): string | undefined {
	for (const [key, column] of Object.entries(collection.columns)) {
		if (column === collection.pk) return key;
	}
	return undefined;
}
