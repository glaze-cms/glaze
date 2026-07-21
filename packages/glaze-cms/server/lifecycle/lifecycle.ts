/**
 * The server lifecycle — `start` and `stop`, mirroring Elysia's `onStart`/`onStop`. On start: verify
 * the database is reachable, failing **loud** (a thrown, typed error) if not, so a misconfigured
 * database surfaces at boot rather than on the first request. On stop: close the database handle so the
 * process can exit cleanly.
 *
 * NOTE — convergence-at-boot is intentionally deferred. `converge()` needs a schema *path* (drizzle-kit
 * `generate` reads a file), but `glaze.config.ts` currently provides `schema` as an *object*.
 * Reconciling that (a config schema-path, or the low-level `generateDrizzleJson(imports)` object path)
 * is a focused follow-up; this is the hook point where it will run.
 */

import type { GlazeContext } from '../app/context.ts';

/**
 * Runs Glaze's startup sequence: verify the database is reachable. (Convergence will run here once the
 * schema-source reconciliation lands — see the module note.)
 *
 * @param context - The Glaze context (db, logger, config, …).
 * @returns Resolves when startup completes; rejects (fails loud) if the database is unreachable.
 */
export async function start(context: GlazeContext): Promise<void> {
	await verifyDatabaseReachable(context);
}

/**
 * Runs Glaze's shutdown sequence: close the database connection.
 *
 * @param context - The Glaze context.
 * @returns Resolves once resources are released.
 */
export async function stop(context: GlazeContext): Promise<void> {
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
