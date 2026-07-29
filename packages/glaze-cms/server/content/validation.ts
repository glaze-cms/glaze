/**
 * Per-collection TypeBox request schemas, generated from the Drizzle table so validation tracks the
 * schema automatically (no hand-authored, drift-prone schemas per collection).
 *
 * The generator is bound to Elysia's OWN TypeBox instance via `createSchemaFactory({ typeboxInstance: t })`
 * so the schemas share one Kind registry — Elysia's validator silently ignores a schema built by a
 * different `@sinclair/typebox` copy (it then treats routes as unvalidated). It uses drizzle's `-legacy`
 * entrypoint, which targets `@sinclair/typebox` 0.34 (what Elysia 1.4 uses); `drizzle-orm/typebox`
 * targets the incompatible bare `typebox` v1. (Flip both when the Elysia 2 swap moves to TypeBox v1.)
 */

import { createSchemaFactory } from 'drizzle-orm/typebox-legacy';
import { t } from 'elysia';

import type { Collection } from './types.ts';
import type { TSchema } from '@sinclair/typebox';

const { createInsertSchema, createUpdateSchema } = createSchemaFactory({ typeboxInstance: t });

/** The request schemas for a collection. */
export interface CollectionSchemas {
	/** POST body — NOT-NULL columns without a default are required; defaulted/generated ones optional. */
	readonly body: TSchema;
	/** PATCH body — every column optional, with the primary key removed (it can never be reassigned). */
	readonly update: TSchema;
}

/**
 * Builds the create/update request schemas for a collection.
 *
 * @param collection - The collection to derive schemas from.
 * @returns Its {@link CollectionSchemas}.
 */
export function buildCollectionSchemas(collection: Collection): CollectionSchemas {
	const body = createInsertSchema(collection.table);
	const full = createUpdateSchema(collection.table);
	const pkKey = pkPropertyName(collection);
	// Omit the PK from the update body: without this Elysia keeps a client-supplied `id` and the update
	// would rewrite the primary key of the addressed row.
	const update = pkKey ? t.Omit(full, [pkKey]) : full;
	return { body, update };
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
