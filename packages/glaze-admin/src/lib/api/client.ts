import { getManifest } from '@/lib/config';

import { ApiError, type FieldError, type GlazeErrorCode } from './error.ts';

/** The discriminated envelope every Glaze API route answers with. */
type ApiResponse<T> =
	| { readonly success: true; readonly data: T; readonly error: null }
	| {
			readonly success: false;
			readonly data: null;
			readonly error: {
				readonly code: GlazeErrorCode;
				readonly message: string;
				readonly fields?: readonly FieldError[];
			};
	  };

/**
 * Builds an absolute URL for an API path, honouring the server's configured API prefix.
 *
 * @param path - A path relative to the API prefix, with a leading slash (e.g. `/posts`).
 * @returns The absolute URL to request.
 */
function toApiUrl(path: string): URL {
	return new URL(`${getManifest().apiPrefix}${path}`, window.location.origin);
}

/**
 * Reads an envelope out of a response, turning a transport-level or non-envelope failure into an
 * {@link ApiError} so callers only ever handle one error type.
 *
 * @param response - The fetch response.
 * @returns The parsed envelope.
 * @throws {ApiError} When the body is not JSON or is not a Glaze envelope.
 */
async function readEnvelope<T>(response: Response): Promise<ApiResponse<T>> {
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new ApiError(
			response.status,
			'INTERNAL',
			`The server answered ${response.status} with a non-JSON body.`,
		);
	}

	if (typeof payload !== 'object' || payload === null || !('success' in payload)) {
		throw new ApiError(
			response.status,
			'INTERNAL',
			'The server answered with an unrecognized response shape.',
		);
	}

	return payload as ApiResponse<T>;
}

/**
 * Requests a Glaze API endpoint and unwraps the `{ success, data, error }` envelope.
 *
 * The session cookie is same-origin and httpOnly, so no token handling is needed here.
 *
 * @param path - A path relative to the API prefix, with a leading slash (e.g. `/posts`).
 * @param init - Standard fetch options; `content-type` is set automatically when a body is present.
 * @returns The `data` payload on success.
 * @throws {ApiError} When the request fails or the envelope reports an error.
 */
export async function requestApi<T>(path: string, init: RequestInit = {}): Promise<T> {
	// Built through `Headers` rather than object spread: `HeadersInit` may be an array of pairs or a
	// `Headers` instance, neither of which survives being spread into an object literal.
	const headers = new Headers(init.headers);
	headers.set('accept', 'application/json');
	if (init.body !== undefined && !headers.has('content-type')) {
		headers.set('content-type', 'application/json');
	}

	const response = await fetch(toApiUrl(path), { ...init, headers });

	const envelope = await readEnvelope<T>(response);
	if (!envelope.success) {
		throw new ApiError(
			response.status,
			envelope.error.code,
			envelope.error.message,
			envelope.error.fields ?? [],
		);
	}

	return envelope.data;
}
