/**
 * Reserved-prefix advisory. Glaze owns `/api`, `/admin`, and `/api/auth`; a user route under any of
 * them may shadow (Elysia is last-wins) or conflict with a core route. Users attach their own routes
 * directly on the returned app, so there is no hard "done adding routes" boundary to throw at — this
 * instead logs a **dev-mode warning** when a user route lands under a reserved prefix. Maximum
 * customization (a user who means to override still can), minimal surprise (they are warned in dev).
 */

import { isProduction } from '#utils';

import type { Logger } from '#logger';
import type { GlazeApp } from '../app/context.ts';
import type { ResolvedGlazeOptions } from '../options/index.ts';

/**
 * The prefixes/paths Glaze owns.
 *
 * @param options - The resolved options.
 * @returns The reserved prefixes (`/api`, `/admin`, and the health path when enabled).
 */
export function reservedPrefixes(options: ResolvedGlazeOptions): string[] {
	const reserved = [options.prefixes.api, options.prefixes.admin];
	if (options.health.enabled) reserved.push(options.health.path);
	return reserved;
}

/**
 * Reports whether a route path falls under a reserved prefix — an exact match, or a child at a `/`
 * boundary. The boundary check matters: `/apidocs` is **not** under `/api`, but `/api/docs` is.
 *
 * @param path - The route path to test (e.g. `/api/posts`).
 * @param reserved - The reserved prefixes.
 * @returns `true` when `path` is reserved.
 */
export function isReservedPath(path: string, reserved: readonly string[]): boolean {
	return reserved.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Captures the identity of every route currently registered, so a later diff can tell which routes the
 * user added (vs Glaze's core).
 *
 * @param app - The Glaze app.
 * @returns A set of `"METHOD path"` keys for the app's current routes.
 */
export function snapshotRoutes(app: GlazeApp): ReadonlySet<string> {
	return new Set(app.routes.map((route) => routeKey(route.method, route.path)));
}

/**
 * Logs a **dev-only** warning for routes added since `coreRoutes` that fall under a reserved prefix. A
 * best-effort advisory — it catches routes registered synchronously after startup (the common case)
 * and never throws (a user may override a core route if they insist).
 *
 * @param app - The Glaze app, after user routes may have been added.
 * @param coreRoutes - The route snapshot taken right after Glaze registered its core routes.
 * @param reserved - The reserved prefixes.
 * @param logger - The logger to warn through.
 */
export function warnReservedCollisions(
	app: GlazeApp,
	coreRoutes: ReadonlySet<string>,
	reserved: readonly string[],
	logger: Logger,
): void {
	if (isProduction()) return;

	const collisions = app.routes
		.filter((route) => !coreRoutes.has(routeKey(route.method, route.path)))
		.filter((route) => isReservedPath(route.path, reserved))
		.map((route) => `${route.method} ${route.path}`);

	if (collisions.length > 0) {
		logger.warn(
			`Route(s) registered under a Glaze-reserved prefix (${reserved.join(', ')}): ` +
				`${collisions.join(', ')}. These may shadow or conflict with Glaze's core routes.`,
		);
	}
}

/**
 * The stable identity key for a route.
 *
 * @param method - The HTTP method.
 * @param path - The route path.
 * @returns A `"METHOD path"` key.
 */
function routeKey(method: string, path: string): string {
	return `${method} ${path}`;
}
