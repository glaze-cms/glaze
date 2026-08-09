/**
 * The content router: auto-generated `/{apiPrefix}/{collection}` CRUD routes, one collection per Drizzle
 * table. Reads top-down — drop excluded/reserved collections, build the guarded base app (the auth macro
 * plus content-scoped CORS and validation-error normalization), then register each collection's routes.
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
import { buildErrorResponse, buildSuccessResponse } from '../responses/index.ts';
import { createCorsResponder } from '../security/index.ts';
import {
	coerceId,
	createRow,
	deleteRow,
	getRow,
	listRows,
	updateRow,
	type ContentDb,
	type Row,
} from './handlers.ts';
import { buildCollectionSchemas } from './validation.ts';

import type { ConstraintClassifier, ConstraintKind, ConstraintViolation } from '#dialect';
import type { Logger } from '#logger';
import type { GlazeErrorCode } from '#types';
import type { GlazeContext } from '../app/context.ts';
import type { SessionProvider } from '../auth/index.ts';
import type { CorsResponder } from '../security/index.ts';
import type { Collection } from './types.ts';

/** The default and maximum page sizes for a list request. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
/** Cap `offset` at the safe-integer ceiling so a huge value can't overflow the driver's bind type. */
const MAX_OFFSET = Number.MAX_SAFE_INTEGER;

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
 * Builds the guarded base app: the named content plugin with the auth macro, a local validation-error
 * normalizer (Elysia's `VALIDATION` → the 422 envelope), and — when CORS is configured — a local
 * `onAfterHandle` stamping the content-scoped CORS headers. Both hooks are local, so they never leak
 * onto sibling scopes (the root manifest or the auth routes). Extracted so its type (which carries the
 * `auth` macro) can name the per-collection registrar.
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

/**
 * Registers one collection's CRUD routes onto the content app (Elysia mutates in place). POST/PATCH
 * carry the generated body schemas (Elysia validates + strips unknown fields before the handler runs).
 * Id-keyed routes are registered only when the collection has a single-column primary key; an ungated
 * `OPTIONS` preflight is registered alongside each path when CORS is configured.
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
	const { body, update } = buildCollectionSchemas(collection);

	// Schema/options precede the handler.
	app.get(base, { auth: true }, async ({ query }) =>
		buildSuccessResponse(
			await listRows(db, collection, parseLimit(query.limit), parseOffset(query.offset)),
		),
	);

	app.post(base, { auth: true, body }, async ({ body: input }) =>
		status(201, buildSuccessResponse(await createRow(db, collection, input as Row))),
	);

	if (responder) app.options(base, ({ request }) => responder.preflight(request));

	if (!collection.pk) return;

	app.get(`${base}/:id`, { auth: true }, async ({ params }) => {
		const id = coerceId(collection, params.id);
		if (!id.ok) return buildErrorResponse(400, 'INVALID_ID', 'Invalid id for this collection');
		const row = await getRow(db, collection, id.value);
		return row ? buildSuccessResponse(row) : buildErrorResponse(404, 'NOT_FOUND', 'Not found');
	});

	app.patch(`${base}/:id`, { auth: true, body: update }, async ({ params, body: input }) => {
		const id = coerceId(collection, params.id);
		if (!id.ok) return buildErrorResponse(400, 'INVALID_ID', 'Invalid id for this collection');
		const values = input as Row;
		if (Object.keys(values).length === 0) {
			return buildErrorResponse(422, 'VALIDATION', 'Request body has no fields to update');
		}
		const row = await updateRow(db, collection, id.value, values);
		return row ? buildSuccessResponse(row) : buildErrorResponse(404, 'NOT_FOUND', 'Not found');
	});

	app.delete(`${base}/:id`, { auth: true }, async ({ params }) => {
		const id = coerceId(collection, params.id);
		if (!id.ok) return buildErrorResponse(400, 'INVALID_ID', 'Invalid id for this collection');
		const deleted = await deleteRow(db, collection, id.value);
		return deleted
			? buildSuccessResponse({ deleted: true })
			: buildErrorResponse(404, 'NOT_FOUND', 'Not found');
	});

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
	const { config, options, logger } = context;
	const responder = createCorsResponder(options.security.cors);
	const classifyConstraint = resolveDialect(config.dialect).classifyConstraint;
	const served = servableCollections(
		collections,
		new Set(options.content.exclude),
		options.prefixes.api,
		logger,
	);

	const app = createContentApp(auth, responder, logger, classifyConstraint);
	const db = context.db.db as ContentDb;
	for (const collection of served) {
		registerCollectionRoutes(app, collection, db, options.prefixes.api, responder);
	}
	return app;
}
