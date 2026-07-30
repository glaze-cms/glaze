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
 * The response envelope. Discriminated on `success`, with all three keys always present (the inactive
 * side is `null`) — so `if (res.success)` narrows `data` to `T`.
 *
 * @example
 * ```ts
 * const res: ApiResponse<Post> = await (await fetch('/api/posts', { method: 'POST', body }))
 * 	.json();
 * if (res.success) console.log(res.data.title);
 * else if (res.error.code === 'CONFLICT') console.error(res.error.fields); // e.g. title must be unique
 * ```
 */
export type ApiResponse<T> =
	| { readonly success: true; readonly data: T; readonly error: null }
	| { readonly success: false; readonly data: null; readonly error: GlazeError };
