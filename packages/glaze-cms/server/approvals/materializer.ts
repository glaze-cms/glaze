/**
 * Materializes Glaze's pending-approvals tables at boot via the dialect seam's **create-once**
 * `ensureSchema` — the same path the auth tables take, and for the same reason: it adds its own
 * tables if absent and is a no-op once they exist, so it can never touch user content.
 *
 * They are created whether or not `audit` is on. The trail is worth nothing if it starts the day
 * someone flips the setting, and the role assignment it holds is needed either way.
 */

import { buildApprovalSchema } from './schema/index.ts';

import type { GlazeContext } from '../app/context.ts';

/**
 * Creates Glaze's approvals tables in the live database if they do not already exist.
 *
 * @param context - The Glaze context (database handle, config, logger).
 * @returns Resolves once the approvals schema is materialized.
 */
export async function materializeApprovalTables(context: GlazeContext): Promise<void> {
	const { db, config, logger } = context;

	const schema = buildApprovalSchema(config.dialect);
	const applied = await db.ensureSchema(schema);

	if (applied.length > 0) {
		logger.info(`Glaze created the approvals schema (${applied.length} statement(s)).`);
	}
}
