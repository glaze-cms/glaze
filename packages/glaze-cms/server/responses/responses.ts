/**
 * Builders for the Glaze API response envelope ({@link ApiResponse}). One source of truth for the
 * `{ success, data, error }` shape, so every content endpoint — and the auth gate — stays identical.
 * Lives at the server root (not under `content/`) so `auth` can reuse it without depending on `content`.
 */

import { status } from 'elysia';

import type {
	ApiListResponse,
	ApiResponse,
	GlazeError,
	GlazeErrorCode,
	ResponseMetadata,
} from '#types';

/**
 * Wraps a payload as a successful response envelope (HTTP 200 by default; wrap in `status(201, …)` for a
 * created resource). Pass `meta` for a list response; omitting it leaves the key absent, so non-list
 * bodies carry exactly `{ success, data, error }`.
 *
 * @param data - The payload.
 * @param meta - Optional pagination detail for a list response.
 * @returns The success envelope.
 */
export function buildSuccessResponse<T>(data: T): Extract<ApiResponse<T>, { success: true }> {
	return { success: true, data, error: null } satisfies ApiResponse<T>;
}

/**
 * Wraps a page of rows as a successful list envelope, carrying its {@link ResponseMetadata}.
 *
 * Separate from {@link buildSuccessResponse} so `meta` is required by the type rather than optional —
 * a list response that forgot it would otherwise compile.
 *
 * @param data - The page of rows.
 * @param meta - The pagination detail describing the page.
 * @returns The success envelope.
 */
export function buildListResponse<T>(
	data: T[],
	meta: ResponseMetadata,
): Extract<ApiListResponse<T>, { success: true }> {
	return { success: true, data, error: null, meta } satisfies ApiListResponse<T>;
}

/**
 * Builds a failed response at the given HTTP status, carrying a typed {@link GlazeError}. Returns
 * Elysia's `status(...)` value, so a handler (or `onError`) can `return` it directly.
 *
 * @param httpStatus - The HTTP status code.
 * @param code - The machine-readable error code.
 * @param message - A human-readable description.
 * @param fields - Optional per-field validation detail.
 * @returns The Elysia status response carrying the failure envelope.
 */
export function buildErrorResponse(
	httpStatus: number,
	code: GlazeErrorCode,
	message: string,
	fields?: GlazeError['fields'],
) {
	const error: GlazeError = fields ? { code, message, fields } : { code, message };
	return status(httpStatus, { success: false, data: null, error } satisfies ApiResponse<never>);
}
