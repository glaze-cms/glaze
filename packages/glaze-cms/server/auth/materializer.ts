/**
 * Materializes Glaze's internal auth tables at boot via the dialect seam's **create-once**
 * `ensureSchema`: it creates the auth tables if absent (dialect-correct DDL from drizzle-kit, applied
 * atomically) and is a no-op once they exist. It deliberately does NOT diff against the live database
 * — a diff would drop user tables that aren't part of the auth schema. Schema *evolution* (a future
 * Better Auth version changing the auth tables) is out of scope here; it belongs to the full-schema
 * convergence engine and will fold in when convergence-at-boot lands.
 */

import { buildAuthSchema } from './schema/index.ts';

import type { GlazeContext } from '../app/context.ts';

/**
 * Creates Glaze's auth tables in the live database if they do not already exist.
 *
 * @param context - The Glaze context (database handle, config, logger).
 * @returns Resolves once the auth schema is materialized.
 */
export async function materializeAuthTables(context: GlazeContext): Promise<void> {
	const { db, config, logger } = context;

	const schema = buildAuthSchema(config.dialect);
	const applied = await db.ensureSchema(schema);

	if (applied.length > 0) {
		logger.info(`Glaze created the auth schema (${applied.length} statement(s)).`);
	}
}
