/**
 * The Glaze API response contract — a strict, discriminated envelope every content endpoint (and the
 * auth gate) returns, so clients parse one predictable shape. The typed {@link GlazeErrorCode} is the
 * translatable surface an Admin UI keys off (it grows toward the convergence error-code set).
 */

/** A stable, machine-readable error code — the key a UI translates, independent of the human message. */
export type GlazeErrorCode =
	| 'VALIDATION'
	| 'NOT_FOUND'
	| 'INVALID_ID'
	| 'UNAUTHORIZED'
	| 'FORBIDDEN'
	| 'CONFLICT'
	| 'FOREIGN_KEY'
	| 'NOT_NULL'
	| 'CHECK'
	| 'INTERNAL';

/** A structured API error: a translatable code, a human message, and optional per-field detail. */
export interface GlazeError {
	/** The machine-readable, translatable error code. */
	readonly code: GlazeErrorCode;
	/** A human-readable description (English by default; a UI may translate by `code`). */
	readonly message: string;
	/** Per-field detail, present when the error is a request-validation failure. */
	readonly fields?: readonly { readonly path: string; readonly message: string }[];
}

/**
 * Response detail that describes the payload rather than being part of it — today, list pagination.
 * Rides alongside `data` rather than wrapping it, so a list payload stays a bare array.
 */
export interface ResponseMetadata {
	/**
	 * Total rows matching the query, ignoring `limit`/`offset` — the count a pager needs. `null` when the
	 * request did not ask for one (`?count=true`), because counting doubles the cost of a list and only a
	 * paginated view needs it.
	 */
	readonly total: number | null;
	/** The page size actually applied (the request's `limit`, bounded). */
	readonly limit: number;
	/** The row offset actually applied. */
	readonly offset: number;
}

/**
 * The response envelope. Discriminated on `success`, with all three keys always present (the inactive
 * side is `null`) — so `if (res.success)` narrows `data` to `T`.
 *
 * A list endpoint answers with {@link ApiListResponse} instead, which additionally carries `meta`.
 *
 * @example
 * ```ts
 * const res: ApiResponse<Post> = await (await fetch('/api/posts', { method: 'POST', body }))
 * 	.json();
 * if (res.success) console.log(res.data.title);
 * else if (res.error.code === 'CONFLICT') console.error(res.error.fields); // e.g. title must be unique
 * ```
 *
 */
export type ApiResponse<T> =
	| { readonly success: true; readonly data: T; readonly error: null }
	| { readonly success: false; readonly data: null; readonly error: GlazeError };

/**
 * The envelope a **list** endpoint answers with: the same discriminated shape, plus a
 * {@link ResponseMetadata} that is always present on success.
 *
 * A separate type rather than an optional key on {@link ApiResponse}, so the type states which kind of
 * response a caller holds. Were `meta` optional on the shared envelope, every consumer of a list would
 * write a runtime null-check for something the server always sends.
 *
 * @example
 * ```ts
 * const res: ApiListResponse<Post> = await (await fetch('/api/posts?limit=10&count=true')).json();
 * if (res.success) console.log(`${res.data.length} of ${res.meta.total ?? 'many'}`);
 * ```
 */
export type ApiListResponse<T> =
	| {
			readonly success: true;
			readonly data: T[];
			readonly error: null;
			readonly meta: ResponseMetadata;
	  }
	| { readonly success: false; readonly data: null; readonly error: GlazeError };
