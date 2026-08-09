/**
 * The composition root: assembles the Glaze Elysia app from the resolved context. Reads top-down like
 * a table of contents — decorate the context, then register the core chain (security headers → health →
 * root manifest) and wire graceful shutdown. The returned app is the chainable instance users attach
 * their own routes to; startup/listen is driven by the entry point.
 *
 * (Content-API CORS mounts with the content API — it must share a scope with the `/api` routes it
 * guards, which land in a later increment.)
 */

import { Elysia } from 'elysia';

import { createAuth, createAuthPlugin } from '../auth/index.ts';
import { createContentRouter } from '../content/index.ts';
import { createDocsPlugin } from '../docs/index.ts';
import { createHealthCheck } from '../health/index.ts';
import { handleStop } from '../lifecycle/index.ts';
import { createSecurityHeaders } from '../security/index.ts';
import { selectAdapter } from './adapter.ts';

import type { Collection } from '../content/index.ts';
import type { ResolvedGlazeOptions } from '../options/index.ts';
import type { GlazeApp, GlazeContext } from './context.ts';

/** The discovery manifest returned by `GET /`: the server's name and where its surfaces are mounted. */
interface GlazeManifest {
	/** The framework name. */
	readonly name: string;
	/** The content/API mount prefix. */
	readonly apiPrefix: string;
	/** The admin app mount prefix. */
	readonly adminPrefix: string;
	/** The health route path, or `null` when the health check is disabled. */
	readonly healthPath: string | null;
}

/**
 * Builds the Glaze app: the decorated Elysia instance with the core chain and graceful shutdown wired.
 *
 * @param context - The resolved Glaze context (db, config, options, logger, runtime).
 * @param collections - The content collections derived from the developer's schema (empty ⇒ no CRUD).
 * @returns The composed Glaze app, ready to `listen`.
 */
export function createGlazeApp(
	context: GlazeContext,
	collections: readonly Collection[],
): GlazeApp {
	const { options } = context;

	const adapter = selectAdapter(context.runtime.name);

	// One Better Auth instance, shared by the auth plugin (which mounts its handler) and the content
	// router's protection macro (which reads sessions) — never two engines.
	const auth = createAuth(context);

	const app = new Elysia(adapter ? { adapter } : {})
		.decorate(context)
		.use(createSecurityHeaders(options.security.headers))
		.use(createHealthCheck(options.health))
		.use(createAuthPlugin(context, auth))
		.use(createContentRouter({ context, auth, collections }))
		.use(createDocsPlugin(options.docs, options.prefixes.api))
		.get('/', () => buildManifest(options))
		.cleanup(() => handleStop(context));

	return app as unknown as GlazeApp;
}

/**
 * Builds the discovery manifest served at `GET /`.
 *
 * @param options - The resolved options.
 * @returns The manifest describing the server's mount points.
 */
function buildManifest(options: ResolvedGlazeOptions): GlazeManifest {
	return {
		name: 'glaze',
		apiPrefix: options.prefixes.api,
		adminPrefix: options.prefixes.admin,
		healthPath: options.health.enabled ? options.health.path : null,
	};
}
