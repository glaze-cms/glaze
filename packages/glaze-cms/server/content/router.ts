/**
 * The content router: auto-generated `/{apiPrefix}/{collection}` CRUD routes, one collection per Drizzle
 * table. Reads top-down — drop excluded/reserved collections, build the guarded base app (the auth macro
 * plus content-scoped CORS), then register each collection's routes onto it. Every content route opts
 * into `{ auth: true }`, so the macro gates it (401 without a session) and injects `user`/`session`.
 *
 * A table with a single-column primary key gets the full set (list, create, get/update/delete by id); a
 * table without one gets list + create only. Data access goes through the dialect-agnostic core query
 * builder (see `./handlers.ts`); this file owns only HTTP shape — parsing, status codes, body limits.
 */

import { Elysia } from 'elysia';

import { createAuthMacro } from '../auth/index.ts';
import { createCorsResponder } from '../security/index.ts';
import {
	coerceId,
	createRow,
	deleteRow,
	filterBody,
	getRow,
	listRows,
	updateRow,
	type ContentDb,
} from './handlers.ts';

import type { Logger } from '#logger';
import type { GlazeContext } from '../app/context.ts';
import type { SessionProvider } from '../auth/index.ts';
import type { CorsResponder } from '../security/index.ts';
import type { Collection } from './types.ts';

/** The default and maximum page sizes for a list request. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
/** Cap `offset` at the safe-integer ceiling so a huge value can't overflow the driver's bind type. */
const MAX_OFFSET = Number.MAX_SAFE_INTEGER;

/** The error bodies the router returns, kept as named constants so the shape stays consistent. */
const EMPTY_BODY = { error: 'Request body must be a non-empty object of known fields' } as const;
const INVALID_ID = { error: 'Invalid id for this collection' } as const;
const NOT_FOUND = { error: 'Not found' } as const;

/**
 * Collection names that would collide with a Glaze-owned route and are never served as content. `auth`
 * maps to `{apiPrefix}/auth`, where Better Auth is mounted — a content `/:id` route there would shadow
 * its single-segment endpoints (e.g. `get-session`).
 */
const RESERVED_COLLECTION_NAMES = new Set(['auth']);
/** A collection name is not a safe single URL path segment if it contains any of these. */
const UNSAFE_SEGMENT = /[/\s:*?#[\]]/;

/** The inputs the content router is composed from. */
interface ContentRouterInput {
	/** The Glaze context (db handle, resolved options, logger). */
	readonly context: GlazeContext;
	/** The shared Better Auth instance backing the route gate. */
	readonly auth: SessionProvider;
	/** The collections derived from the developer's schema. */
	readonly collections: readonly Collection[];
}

/**
 * Parses the `?limit=` query into a bounded page size, falling back to the default for missing/invalid
 * values and capping at the maximum.
 *
 * @param raw - The raw query value.
 * @returns A page size in `1..MAX_LIMIT`.
 */
function parseLimit(raw: string | undefined): number {
	const value = Number(raw);
	if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
	return Math.min(Math.floor(value), MAX_LIMIT);
}

/**
 * Parses the `?offset=` query into a non-negative, bounded row offset, falling back to 0 for
 * missing/invalid values.
 *
 * @param raw - The raw query value.
 * @returns A non-negative offset in `0..MAX_OFFSET`.
 */
function parseOffset(raw: string | undefined): number {
	const value = Number(raw);
	if (!Number.isFinite(value) || value < 0) return 0;
	return Math.min(Math.floor(value), MAX_OFFSET);
}

/**
 * Filters the collections to those actually servable as CRUD, warning (once each) about any dropped for
 * an unsafe name or a reserved-route collision. Dropped tables are still managed by convergence.
 *
 * @param collections - All derived collections.
 * @param excluded - Names opted out via `content.exclude`.
 * @param apiPrefix - The API mount prefix (for the warning message).
 * @param logger - The logger to warn through.
 * @returns The collections to register.
 */
function servableCollections(
	collections: readonly Collection[],
	excluded: ReadonlySet<string>,
	apiPrefix: string,
	logger: Logger,
): Collection[] {
	const served: Collection[] = [];
	for (const collection of collections) {
		const { name } = collection;
		if (excluded.has(name)) continue;
		if (!name || UNSAFE_SEGMENT.test(name)) {
			logger.warn(
				`Collection "${name}" is not a valid URL path segment; skipping its CRUD routes.`,
			);
			continue;
		}
		if (RESERVED_COLLECTION_NAMES.has(name)) {
			logger.warn(
				`Collection "${name}" collides with the reserved ${apiPrefix}/${name} route; skipping its ` +
					`CRUD routes (the table is still managed by convergence).`,
			);
			continue;
		}
		served.push(collection);
	}
	return served;
}

/**
 * Builds the guarded base app: the named content plugin with the auth macro applied and, when CORS is
 * configured, a **local** `onAfterHandle` that stamps the content-scoped CORS headers (local so they
 * never leak onto sibling scopes — the root manifest or the auth routes). Extracted so its type (which
 * carries the `auth` macro) can name the per-collection registrar.
 *
 * @param auth - The shared Better Auth instance.
 * @param responder - The content CORS responder, or `null` for deny-by-default.
 * @returns The base Elysia instance, macro-enabled.
 */
function createContentApp(auth: SessionProvider, responder: CorsResponder | null) {
	const app = new Elysia({ name: 'glaze.content' }).use(createAuthMacro(auth));
	if (responder) {
		app.onAfterHandle(({ request, set }) => {
			responder.decorate(set.headers, request.headers.get('origin'));
		});
	}
	return app;
}

/** The content Elysia instance, with the `auth` macro in scope for `{ auth: true }` routes. */
type ContentApp = ReturnType<typeof createContentApp>;

/**
 * Registers one collection's CRUD routes onto the content app (Elysia mutates in place). Id-keyed routes
 * are registered only when the collection has a single-column primary key. When CORS is configured, an
 * ungated `OPTIONS` preflight is registered alongside each path.
 *
 * @param app - The macro-enabled content app.
 * @param collection - The collection to expose.
 * @param db - The content database.
 * @param apiPrefix - The API mount prefix (e.g. `/api`).
 * @param responder - The content CORS responder, or `null`.
 */
function registerCollectionRoutes(
	app: ContentApp,
	collection: Collection,
	db: ContentDb,
	apiPrefix: string,
	responder: CorsResponder | null,
): void {
	const base = `${apiPrefix}/${collection.name}`;

	app.get(
		base,
		({ query }) => listRows(db, collection, parseLimit(query.limit), parseOffset(query.offset)),
		{ auth: true },
	);

	app.post(
		base,
		async ({ body, status }) => {
			const values = filterBody(collection, body, { excludePk: false });
			if (!values || Object.keys(values).length === 0) return status(400, EMPTY_BODY);
			return status(201, await createRow(db, collection, values));
		},
		{ auth: true },
	);

	if (responder) app.options(base, ({ request }) => responder.preflight(request));

	if (!collection.pk) return;

	app.get(
		`${base}/:id`,
		async ({ params, status }) => {
			const id = coerceId(collection, params.id);
			if (!id.ok) return status(400, INVALID_ID);
			const row = await getRow(db, collection, id.value);
			return row ?? status(404, NOT_FOUND);
		},
		{ auth: true },
	);

	app.patch(
		`${base}/:id`,
		async ({ params, body, status }) => {
			const id = coerceId(collection, params.id);
			if (!id.ok) return status(400, INVALID_ID);
			const values = filterBody(collection, body, { excludePk: true });
			if (!values || Object.keys(values).length === 0) return status(400, EMPTY_BODY);
			const row = await updateRow(db, collection, id.value, values);
			return row ?? status(404, NOT_FOUND);
		},
		{ auth: true },
	);

	app.delete(
		`${base}/:id`,
		async ({ params, status }) => {
			const id = coerceId(collection, params.id);
			if (!id.ok) return status(400, INVALID_ID);
			const deleted = await deleteRow(db, collection, id.value);
			// 200 with a small body (not 204): a null-body 204 is invalid under undici (Node), and a raw
			// 204 Response would bypass the CORS/security-header merge — this keeps both, cross-runtime.
			return deleted ? { deleted: true } : status(404, NOT_FOUND);
		},
		{ auth: true },
	);

	if (responder) app.options(`${base}/:id`, ({ request }) => responder.preflight(request));
}

/**
 * Builds the content router. Absent any servable collection it returns the guarded base app with no
 * content routes (still a valid, mountable plugin).
 *
 * @param input - The context, shared auth instance, and derived collections.
 * @returns An Elysia plugin exposing the CRUD routes.
 */
export function createContentRouter({
	context,
	auth,
	collections,
}: ContentRouterInput): ContentApp {
	const { options, logger } = context;
	const responder = createCorsResponder(options.security.cors);
	const served = servableCollections(
		collections,
		new Set(options.content.exclude),
		options.prefixes.api,
		logger,
	);

	const app = createContentApp(auth, responder);
	const db = context.db.db as ContentDb;
	for (const collection of served) {
		registerCollectionRoutes(app, collection, db, options.prefixes.api, responder);
	}
	return app;
}
