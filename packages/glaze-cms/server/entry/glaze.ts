/**
 * The `glaze()` entry point — the one call that boots the Glaze server. Loads the tooling config from
 * `glaze.config.ts`, resolves runtime options, opens the database (dialect seam), composes the app,
 * verifies the database is reachable, and starts listening. Returns the app so callers may attach
 * their own routes/plugins — but ignoring the return is fine: `glaze({…})` alone runs the server.
 */

import { loadConfig, resolveConfig } from '#config';
import { resolveDialect } from '#dialect';
import { createLogger } from '#logger';
import { resolveRuntime } from '#runtime';

import { createGlazeApp } from '../app/index.ts';
import { handleStart } from '../lifecycle/index.ts';
import { resolveOptions } from '../options/index.ts';
import { reservedPrefixes, snapshotRoutes, warnReservedCollisions } from '../reserved/index.ts';

import type { Logger } from '#logger';
import type { GlazeApp, GlazeContext } from '../app/index.ts';
import type { GlazeOptions, ResolvedGlazeOptions } from '../options/index.ts';

/**
 * Boots the Glaze server: compose the app, verify the database is reachable, and listen.
 *
 * @param options - Runtime options (port/security/prefixes/health/logger). All optional.
 * @returns The running Glaze app (chainable — attach your own routes, or ignore it).
 */
export async function glaze(options: GlazeOptions = {}): Promise<GlazeApp> {
	const resolvedOptions = resolveOptions(options);
	const logger = createLogger(resolvedOptions.logger);
	const config = resolveConfig(await loadConfig());
	const runtime = resolveRuntime();
	const db = await resolveDialect(config.dialect).createDatabase({ connection: config.connection });

	const context: GlazeContext = { db, config, options: resolvedOptions, logger, runtime };

	try {
		// Composition can throw before listen (e.g. the auth secret guard fails closed in production),
		// so it lives inside the try alongside start — any failure after the DB is open must release it.
		const app = createGlazeApp(context);
		const coreRoutes = snapshotRoutes(app);

		await handleStart(context);
		app.listen(resolvedOptions.port);

		installShutdownHandlers(app);
		scheduleReservedWarning(app, coreRoutes, resolvedOptions, logger);

		return app;
	} catch (error) {
		// Boot failed after the DB was opened — release it so a failed start doesn't leak the connection.
		await context.db.close().catch((closeError: unknown) => {
			logger.error(`Failed to close the database after a boot failure: ${String(closeError)}`);
		});
		throw error;
	}
}

/**
 * Registers SIGINT/SIGTERM handlers that gracefully stop the server (which triggers `onStop` →
 * `handleStop` → the DB is closed), then exit — so a container stop / Ctrl-C drains cleanly instead of
 * dropping the connection. `once` so a second signal falls through to the default (hard) terminate.
 *
 * @param app - The running app to stop.
 */
function installShutdownHandlers(app: GlazeApp): void {
	const shutdown = (): void => {
		void app.stop().finally(() => {
			process.exit(0);
		});
	};
	process.once('SIGINT', shutdown);
	process.once('SIGTERM', shutdown);
}

/**
 * Schedules a best-effort, dev-only warning about user routes under a reserved prefix, deferred past
 * the current tick so routes the caller adds synchronously after `glaze()` resolves are seen.
 *
 * @param app - The running app.
 * @param coreRoutes - The route snapshot taken right after Glaze registered its core routes.
 * @param options - The resolved options (source of the reserved prefixes).
 * @param logger - The logger to warn through.
 */
function scheduleReservedWarning(
	app: GlazeApp,
	coreRoutes: ReadonlySet<string>,
	options: ResolvedGlazeOptions,
	logger: Logger,
): void {
	setTimeout(() => {
		warnReservedCollisions(app, coreRoutes, reservedPrefixes(options), logger);
	}, 0);
}
