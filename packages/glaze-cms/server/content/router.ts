/**
 * The content router: auto-generated `/{apiPrefix}/{entity}` CRUD routes, one entity per Drizzle
 * table. Reads top-down — drop excluded/reserved entities, build the guarded base app (the auth macro
 * plus content-scoped CORS and validation-error normalization), then register each entity's routes.
 * Every content route opts into `{ auth: true }`, so the macro gates it (401 without a session) and
 * injects `user`/`session`; POST/PATCH also carry a generated TypeBox body schema.
 *
 * A table with a single-column primary key gets the full set (list, create, get/update/delete by id); a
 * table without one gets list + create only. Every response is the `{ success, data, error }` envelope
 * (see `../responses`). Data access goes through the dialect-agnostic core query builder (`./handlers.ts`).
 */

import { Elysia, NotFound, ParseError, status, ValidationError } from 'elysia';

import { resolveDialect } from '#dialect';

import { createAuthMacro } from '../auth/index.ts';
import { buildErrorResponse, buildListResponse, buildSuccessResponse } from '../responses/index.ts';
import { createCorsResponder } from '../security/index.ts';
import { SETUP_ROUTE_NAME } from '../setup/index.ts';
import { describeContentModel } from './descriptor/index.ts';
import {
	buildFilter,
	coerceId,
	createRow,
	deleteRow,
	getRow,
	isFilterOperator,
	readRowPage,
	updateRow,
	type ContentDb,
	type ListQuery,
	type Row,
} from './handlers.ts';
import { buildEntitySchemas } from './validation.ts';

import type {
	ConstraintClassifier,
	ConstraintKind,
	ConstraintViolation,
	DatabaseHandle,
} from '#dialect';
import type { Logger } from '#logger';
import type { GlazeErrorCode } from '#types';
import type { GlazeContext } from '../app/context.ts';
import type { SessionProvider } from '../auth/index.ts';
import type { CorsResponder } from '../security/index.ts';
import type { Entity } from './types.ts';
import type { Column, SQL } from 'drizzle-orm';

/** The default and maximum page sizes for a list request. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
/** Cap `offset` at the safe-integer ceiling so a huge value can't overflow the driver's bind type. */
const MAX_OFFSET = Number.MAX_SAFE_INTEGER;

/** The path segment serving the content-model descriptor, under the API prefix. */
const ENTITIES_ROUTE_NAME = 'entities';

/**
 * Entity names that would collide with a Glaze-owned route and are never served as content. `auth`
 * maps to `{apiPrefix}/auth`, where Better Auth is mounted — a content `/:id` route there would shadow
 * its single-segment endpoints (e.g. `get-session`). `setup` is where the first admin is claimed, and
 * `entities` is the content-model descriptor.
 */
const RESERVED_ENTITY_NAMES = new Set(['auth', SETUP_ROUTE_NAME, ENTITIES_ROUTE_NAME]);
/** An entity name is not a safe single URL path segment if it contains any of these. */
const UNSAFE_SEGMENT = /[/\s:*?#[\]]/;

/** The inputs the content router is composed from. */
interface ContentRouterInput {
	/** The Glaze context (db handle, resolved options, logger). */
	readonly context: GlazeContext;
	/** The shared Better Auth instance backing the route gate. */
	readonly auth: SessionProvider;
	/** The entities derived from the developer's schema. */
	readonly entities: readonly Entity[];
}

/**
 * Extracts per-field detail from an Elysia validation error into the envelope's `fields` shape.
 *
 * @param error - The error thrown for a `VALIDATION` failure.
 * @returns The field-level messages (empty when none can be read).
 */
function toValidationFields(error: unknown): { path: string; message: string }[] {
	const all = (error as { all?: unknown }).all;
	if (!Array.isArray(all)) return [];
	const fields: { path: string; message: string }[] = [];
	for (const item of all as { path?: unknown; message?: unknown }[]) {
		if (typeof item.path === 'string' && typeof item.message === 'string') {
			fields.push({ path: item.path, message: item.message });
		}
	}
	return fields;
}

/** How each constraint-violation kind maps to a typed HTTP response (status + code + messages). */
const CONSTRAINT_RESPONSES: Record<
	ConstraintKind,
	{ status: number; code: GlazeErrorCode; message: string; fieldMessage: string }
> = {
	unique: {
		status: 409,
		code: 'CONFLICT',
		message: 'A record with these values already exists',
		fieldMessage: 'must be unique',
	},
	foreign_key: {
		status: 409,
		code: 'FOREIGN_KEY',
		message: 'A referenced record does not exist or is still in use',
		fieldMessage: 'references a missing record',
	},
	not_null: {
		status: 422,
		code: 'NOT_NULL',
		message: 'A required field is missing',
		fieldMessage: 'is required',
	},
	check: {
		status: 422,
		code: 'CHECK',
		message: 'A value violates a database constraint',
		fieldMessage: 'failed a constraint',
	},
	unknown: {
		status: 409,
		code: 'CONFLICT',
		message: 'The request conflicts with a database constraint',
		fieldMessage: 'violates a constraint',
	},
};

/**
 * Maps a classified constraint violation to its typed 4xx envelope, naming the offending column(s) in
 * `fields` when the driver reported them.
 *
 * @param violation - The dialect-agnostic violation from the classifier.
 * @returns The Elysia status response carrying the failure envelope.
 */
function mapConstraintViolation(violation: ConstraintViolation) {
	const spec = CONSTRAINT_RESPONSES[violation.kind];
	const fields = violation.columns.map((column) => ({ path: column, message: spec.fieldMessage }));
	return buildErrorResponse(
		spec.status,
		spec.code,
		spec.message,
		fields.length ? fields : undefined,
	);
}

/**
 * Filters the entities to those actually servable as CRUD, warning (once each) about any dropped for
 * an unsafe name or a reserved-route collision. Dropped tables are still managed by convergence.
 *
 * @param entities - All derived entities.
 * @param excluded - Names opted out via `content.exclude`.
 * @param apiPrefix - The API mount prefix (for the warning message).
 * @param logger - The logger to warn through.
 * @returns The entities to register.
 */
function servableEntities(
	entities: readonly Entity[],
	excluded: ReadonlySet<string>,
	apiPrefix: string,
	logger: Logger,
): Entity[] {
	const served: Entity[] = [];
	for (const entity of entities) {
		const { name } = entity;
		if (excluded.has(name)) continue;
		if (!name || UNSAFE_SEGMENT.test(name)) {
			logger.warn(`Entity "${name}" is not a valid URL path segment; skipping its CRUD routes.`);
			continue;
		}
		if (RESERVED_ENTITY_NAMES.has(name)) {
			logger.warn(
				`Entity "${name}" collides with the reserved ${apiPrefix}/${name} route; skipping its ` +
					`CRUD routes (the table is still managed by convergence).`,
			);
			continue;
		}
		served.push(entity);
	}
	return served;
}

/**
 * Builds the guarded base app: the named content plugin with the auth macro, a local validation-error
 * normalizer (Elysia's `VALIDATION` → the 422 envelope), and — when CORS is configured — a local
 * `onAfterHandle` stamping the content-scoped CORS headers. Both hooks are local, so they never leak
 * onto sibling scopes (the root manifest or the auth routes). Extracted so its type (which carries the
 * `auth` macro) can name the per-entity registrar.
 *
 * @param auth - The shared Better Auth instance.
 * @param responder - The content CORS responder, or `null` for deny-by-default.
 * @param logger - The logger, for unexpected content-route errors.
 * @param classifyConstraint - The dialect's constraint-error classifier (maps driver throws to 4xx).
 * @returns The base Elysia instance, macro-enabled.
 */
function createContentApp(
	auth: SessionProvider,
	responder: CorsResponder | null,
	logger: Logger,
	classifyConstraint: ConstraintClassifier,
) {
	const app = new Elysia({ name: 'glaze.content' })
		.use(createAuthMacro(auth))
		// Keep EVERY content-route error in the { success, data, error } envelope (application/json): an
		// error left unhandled here ships as the framework default `application/problem+json`, breaking the
		// response contract. Body-schema failures → 422, malformed JSON → 400, a genuine not-found → the 404
		// envelope, a DB constraint violation → its typed 4xx, and any other throw is logged + enveloped as 500.
		.error(({ error }) => {
			if (error instanceof ValidationError) {
				return buildErrorResponse(
					422,
					'VALIDATION',
					'Request body failed validation',
					toValidationFields(error),
				);
			}
			if (error instanceof ParseError)
				return buildErrorResponse(400, 'VALIDATION', 'Request body is not valid JSON');
			if (error instanceof NotFound) return buildErrorResponse(404, 'NOT_FOUND', 'Not found');
			const violation = classifyConstraint(error);
			if (violation) {
				// A client error (they sent a value the schema-level checks can't catch), not an incident.
				logger.debug(`Content constraint violation (${violation.kind}) mapped to a 4xx response`);
				return mapConstraintViolation(violation);
			}
			const detail =
				error instanceof Error ? (error.stack ?? error.message) : JSON.stringify(error);
			logger.error(`Unhandled content-route error: ${detail}`);
			return buildErrorResponse(500, 'INTERNAL', 'Internal server error');
		});
	if (responder) {
		app.afterHandle(({ request, set }) => {
			responder.decorate(set.headers, request.headers.get('origin'));
		});
	}
	return app;
}

/** The content Elysia instance, with the `auth` macro in scope for `{ auth: true }` routes. */
type ContentApp = ReturnType<typeof createContentApp>;

/** Query parameters the list route interprets itself. Anything outside them and `filter[…]` is ignored. */
const PAGING_PARAMS = new Set(['limit', 'offset', 'sort', 'order', 'count']);

/**
 * A `filter[field]` or `filter[field][operator]` query key.
 *
 * Filters are namespaced rather than bare so the route can tell a filter from the many other things
 * that end up in a query string. A CDN, a WAF, jQuery's cache-buster (`?_=1699999`) and any shared link
 * carrying `utm_source` all append parameters; under a bare `?field=value` grammar every one of them
 * became "unknown filter field" and hard-failed the request. Bracket namespacing is also what the
 * ecosystem uses — JSON:API specifies `filter[title]`, Strapi and Payload both nest the operator.
 */
const FILTER_KEY = /^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/;

/** A parsed list query, or the reason the request was rejected. */
type ParsedListQuery =
	| { ok: true; query: ListQuery; count: boolean }
	| { ok: false; message: string };

/**
 * Looks up a column by property name, safely.
 *
 * `getTableColumns` returns an ordinary object, so a plain `columns[name]` lookup reaches
 * `Object.prototype`: `columns['constructor']` is a truthy function that sails past an `if (!column)`
 * guard and into the query builder, where it becomes a 500 rather than the documented 422 — and a
 * client can emit unbounded stack traces at request rate by repeating it.
 *
 * @param entity - The entity whose columns to search.
 * @param name - The caller-supplied property name.
 * @returns The column, or `undefined` when the entity has no such own property.
 */
function findColumn(entity: Entity, name: string): Column | undefined {
	return Object.hasOwn(entity.columns, name) ? entity.columns[name] : undefined;
}

/**
 * Parses a bounded, non-negative integer query parameter.
 *
 * Rejects rather than defaults, unlike the earlier lenient parse: `?limit=0.5` floored to `LIMIT 0`,
 * which returns an empty page alongside a non-zero total — a pager stepping by `meta.limit` then loops
 * forever. Silently substituting a default for a malformed value is also inconsistent with rejecting a
 * malformed filter in the same request.
 *
 * @param raw - The raw query value.
 * @param bounds - The inclusive minimum and maximum.
 * @returns The parsed value, or `undefined` when the parameter is malformed.
 */
function parseBoundedInteger(
	raw: string | undefined,
	bounds: { min: number; max: number; fallback: number },
): number | undefined {
	if (raw === undefined || raw === '') return bounds.fallback;
	if (!/^\d+$/.test(raw)) return undefined;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < bounds.min) return undefined;
	return Math.min(value, bounds.max);
}

/**
 * Parses a list request's query string into a {@link ListQuery}.
 *
 * An unrecognised field or operator inside `filter[…]` is a **422 rather than a silent no-op** — a
 * filter that quietly does nothing returns more rows than the caller asked for, which looks like
 * success. Parameters outside the namespace are ignored, because they belong to the transport rather
 * than to the query.
 *
 * @param entity - The entity being listed, whose columns bound what may be sorted or filtered.
 * @param query - The raw query-string parameters.
 * @returns The parsed query, or a rejection carrying the message to return.
 */
function parseListQuery(
	entity: Entity,
	query: Record<string, string | undefined>,
): ParsedListQuery {
	const filters: SQL[] = [];

	for (const [key, raw] of Object.entries(query)) {
		if (PAGING_PARAMS.has(key) || raw === undefined) continue;

		const match = FILTER_KEY.exec(key);
		// Not filter-shaped: a cache-buster, an analytics parameter, something a proxy added.
		if (!match) continue;

		const [, field = '', operator = 'eq'] = match;
		const column = findColumn(entity, field);
		if (!column) return { ok: false, message: `Unknown filter field "${field}"` };
		if (!isFilterOperator(operator)) {
			return { ok: false, message: `Unknown filter operator "${operator}"` };
		}

		const filter = buildFilter(column, operator, raw);
		if (!filter) return { ok: false, message: `Invalid value for filter "${key}"` };
		filters.push(filter);
	}

	const sort = query.sort === undefined ? undefined : findColumn(entity, query.sort);
	if (query.sort !== undefined && !sort) {
		return { ok: false, message: `Unknown sort field "${query.sort}"` };
	}
	if (query.order !== undefined && query.order !== 'asc' && query.order !== 'desc') {
		return { ok: false, message: 'Sort order must be "asc" or "desc"' };
	}

	const limit = parseBoundedInteger(query.limit, {
		min: 1,
		max: MAX_LIMIT,
		fallback: DEFAULT_LIMIT,
	});
	if (limit === undefined) return { ok: false, message: `Invalid limit "${query.limit}"` };
	const offset = parseBoundedInteger(query.offset, { min: 0, max: MAX_OFFSET, fallback: 0 });
	if (offset === undefined) return { ok: false, message: `Invalid offset "${query.offset}"` };

	if (query.count !== undefined && query.count !== 'true' && query.count !== 'false') {
		return { ok: false, message: 'Count must be "true" or "false"' };
	}

	return {
		ok: true,
		count: query.count === 'true',
		query: {
			limit,
			offset,
			sort,
			direction: query.order === 'desc' ? 'desc' : 'asc',
			filters,
		},
	};
}

/**
 * Registers one entity's CRUD routes onto the content app (Elysia mutates in place). POST/PATCH
 * carry the generated body schemas (Elysia validates + strips unknown fields before the handler runs).
 * Id-keyed routes are registered only when the entity has a single-column primary key; an ungated
 * `OPTIONS` preflight is registered alongside each path when CORS is configured.
 *
 * @param app - The macro-enabled content app.
 * @param entity - The entity to expose.
 * @param db - The content database.
 * @param handle - The database handle, for the one read that needs a transaction.
 * @param apiPrefix - The API mount prefix (e.g. `/api`).
 * @param responder - The content CORS responder, or `null`.
 */
function registerEntityRoutes(
	app: ContentApp,
	entity: Entity,
	db: ContentDb,
	handle: DatabaseHandle,
	apiPrefix: string,
	responder: CorsResponder | null,
): void {
	const base = `${apiPrefix}/${entity.name}`;
	const { body, update } = buildEntitySchemas(entity);

	// Schema/options precede the handler.
	app.get(base, { auth: true }, async ({ query }) => {
		const parsed = parseListQuery(entity, query);
		if (!parsed.ok) return buildErrorResponse(422, 'VALIDATION', parsed.message);

		const page = await readRowPage(handle, entity, parsed.query, parsed.count);
		return buildListResponse(page.rows, {
			total: page.total,
			limit: parsed.query.limit,
			offset: parsed.query.offset,
		});
	});

	app.post(base, { auth: true, body }, async ({ body: input }) =>
		status(201, buildSuccessResponse(await createRow(db, entity, input as Row))),
	);

	if (responder) app.options(base, ({ request }) => responder.preflight(request));

	if (!entity.pk) return;

	app.get(`${base}/:id`, { auth: true }, async ({ params }) => {
		const id = coerceId(entity, params.id);
		if (!id.ok) return buildErrorResponse(400, 'INVALID_ID', 'Invalid id for this entity');
		const row = await getRow(db, entity, id.value);
		return row ? buildSuccessResponse(row) : buildErrorResponse(404, 'NOT_FOUND', 'Not found');
	});

	app.patch(`${base}/:id`, { auth: true, body: update }, async ({ params, body: input }) => {
		const id = coerceId(entity, params.id);
		if (!id.ok) return buildErrorResponse(400, 'INVALID_ID', 'Invalid id for this entity');
		const values = input as Row;
		if (Object.keys(values).length === 0) {
			return buildErrorResponse(422, 'VALIDATION', 'Request body has no fields to update');
		}
		const row = await updateRow(db, entity, id.value, values);
		return row ? buildSuccessResponse(row) : buildErrorResponse(404, 'NOT_FOUND', 'Not found');
	});

	app.delete(`${base}/:id`, { auth: true }, async ({ params }) => {
		const id = coerceId(entity, params.id);
		if (!id.ok) return buildErrorResponse(400, 'INVALID_ID', 'Invalid id for this entity');
		const deleted = await deleteRow(db, entity, id.value);
		return deleted
			? buildSuccessResponse({ deleted: true })
			: buildErrorResponse(404, 'NOT_FOUND', 'Not found');
	});

	if (responder) app.options(`${base}/:id`, ({ request }) => responder.preflight(request));
}

/**
 * Builds the content router. Absent any servable entity it returns the guarded base app with no
 * content routes (still a valid, mountable plugin).
 *
 * @param input - The context, shared auth instance, and derived entities.
 * @returns An Elysia plugin exposing the CRUD routes.
 */
export function createContentRouter({ context, auth, entities }: ContentRouterInput): ContentApp {
	const { config, options, logger } = context;
	const responder = createCorsResponder(options.security.cors);
	const classifyConstraint = resolveDialect(config.dialect).classifyConstraint;
	const served = servableEntities(
		entities,
		new Set(options.content.exclude),
		options.prefixes.api,
		logger,
	);

	const app = createContentApp(auth, responder, logger, classifyConstraint);
	const db = context.db.db as ContentDb;

	for (const entity of served) {
		registerEntityRoutes(app, entity, db, context.db, options.prefixes.api, responder);
	}

	// Registered AFTER the entity loop. Elysia is last-wins, so registering here is what makes the
	// descriptor route un-shadowable by a user table; registering first would leave the name guard in
	// `servableEntities` as the only thing between a user table and this endpoint. Both together are
	// defence in depth, in that order.
	registerEntitiesRoute(app, served, options.prefixes.api, responder);
	return app;
}

/**
 * Registers `GET {apiPrefix}/schema`, the content model the Admin UI renders from.
 *
 * Mounted on the content app so it inherits the auth macro, the envelope-preserving error handler and
 * the content CORS response — and so it appears in the OpenAPI document alongside the routes it
 * describes.
 *
 * @param app - The macro-enabled content app.
 * @param entities - The servable entities to describe.
 * @param apiPrefix - The API mount prefix (e.g. `/api`).
 * @param responder - The content CORS responder, or `null`.
 */
function registerEntitiesRoute(
	app: ContentApp,
	entities: readonly Entity[],
	apiPrefix: string,
	responder: CorsResponder | null,
): void {
	const path = `${apiPrefix}/${ENTITIES_ROUTE_NAME}`;
	// Described once at startup: the model only changes when the process reloads its schema.
	const descriptor = describeContentModel(entities);

	app.get(path, { auth: true }, () => buildSuccessResponse(descriptor));
	if (responder) app.options(path, ({ request }) => responder.preflight(request));
}
