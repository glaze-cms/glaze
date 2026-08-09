/**
 * The Glaze request context: the object decorated onto every Elysia request, and the typed app handed
 * to the user's `extend` hook. Everything a route handler (Glaze's own or a user's) can reach —
 * `db`, `config`, `options`, `logger`, `runtime` — lives here, resolved once at the composition root.
 */

import type { ResolvedGlazeConfig } from '#config';
import type { DatabaseHandle } from '#dialect';
import type { Logger } from '#logger';
import type { Runtime } from '#runtime';
import type { ResolvedGlazeOptions } from '../options/index.ts';
import type { Elysia } from 'elysia';

/**
 * The values decorated onto every request context — what handlers and the user `extend` hook access.
 * A `type` (not `interface`) so it carries an implicit index signature and satisfies Elysia's
 * `SingletonBase.decorator` (`Record<string, unknown>`) constraint.
 */
export type GlazeContext = {
	/** The live database handle (from the dialect seam). */
	readonly db: DatabaseHandle;
	/** The resolved tooling config loaded from `glaze.config.ts`. */
	readonly config: ResolvedGlazeConfig;
	/** The resolved runtime options passed to `glaze({…})`. */
	readonly options: ResolvedGlazeOptions;
	/** The structured logger. */
	readonly logger: Logger;
	/** The runtime seam (Bun/Node file I/O + spawn). */
	readonly runtime: Runtime;
};

/**
 * The Glaze Elysia app, decorated with {@link GlazeContext}. This is the type of the instance handed to
 * the user's `extend(app)` hook, so their handlers get typed access to `db`/`config`/… on the context.
 */
export type GlazeApp = Elysia<
	'',
	'local',
	{
		decorator: GlazeContext;
		store: Record<string, never>;
		derive: Record<string, never>;
		resolve: Record<string, never>;
	}
>;
