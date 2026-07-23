/**
 * The server lifecycle — `handleStart` and `handleStop`, mirroring Elysia's `onStart`/`onStop`. On
 * start: verify the database is reachable (failing **loud** if not, so a misconfigured database
 * surfaces at boot rather than on the first request), then materialize Glaze's internal auth tables so
 * they exist before the server accepts traffic. On stop: close the database handle so the process can
 * exit cleanly.
 *
 * NOTE — convergence-at-boot for *user content* is intentionally deferred. `converge()` needs a schema
 * *path* (drizzle-kit `generate` reads a file), but `glaze.config.ts` provides `schema` as an *object*.
 * Reconciling that (a config schema-path, or the low-level `generateDrizzleJson(imports)` object path)
 * is a focused follow-up; it will run here alongside the auth materialization.
 */

import { materializeAuthTables } from '../auth/index.ts';

import type { GlazeContext } from '../app/context.ts';

/**
 * Runs Glaze's startup sequence: verify the database is reachable, then materialize the internal auth
 * schema. (User-content convergence will run here once the schema-source reconciliation lands.)
 *
 * @param context - The Glaze context (db, logger, config, …).
 * @returns Resolves when startup completes; rejects (fails loud) if startup cannot complete.
 */
export async function handleStart(context: GlazeContext): Promise<void> {
	await verifyDatabaseReachable(context);
	await materializeAuthTables(context);
}

/**
 * Runs Glaze's shutdown sequence: close the database connection.
 *
 * @param context - The Glaze context.
 * @returns Resolves once resources are released.
 */
export async function handleStop(context: GlazeContext): Promise<void> {
	await context.db.close();
}

/**
 * Verifies the database answers a trivial query, so an unreachable/misconfigured database fails at boot
 * with a clear message rather than on the first request.
 *
 * @param context - The Glaze context (uses `db` and `logger`).
 * @throws {Error} When the database cannot be reached.
 */
async function verifyDatabaseReachable(context: GlazeContext): Promise<void> {
	const { db, logger } = context;
	try {
		await db.raw('SELECT 1');
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		logger.error(`Glaze could not reach the database on startup: ${detail}`);
		throw new Error(`Database unreachable on startup: ${detail}`, { cause: error });
	}
}
