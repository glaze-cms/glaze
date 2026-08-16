import { afterEach, expect, mock, spyOn, test } from 'bun:test';

import { requestApi } from './client.ts';
import { ApiError } from './error.ts';

afterEach(() => {
	mock.restore();
});

/**
 * Replaces `fetch` with a stub for one test.
 *
 * @param response - What the stub should resolve to.
 * @returns The spy, so the request can be inspected.
 */
function stubFetch(response: Response) {
	return spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

test('a successful envelope is unwrapped to its data', async () => {
	stubFetch(Response.json({ success: true, data: [{ id: 1 }], error: null }));

	expect(await requestApi<{ id: number }[]>('/posts')).toEqual([{ id: 1 }]);
});

test('the request targets the path under the configured api prefix', async () => {
	const stub = stubFetch(Response.json({ success: true, data: null, error: null }));

	await requestApi('/posts');

	const [input] = stub.mock.calls[0] ?? [];
	expect(input instanceof URL && input.pathname.endsWith('/posts')).toBe(true);
});

test('an error envelope becomes an ApiError carrying the typed code and fields', async () => {
	stubFetch(
		Response.json(
			{
				success: false,
				data: null,
				error: {
					code: 'VALIDATION',
					message: 'Bad body',
					fields: [{ path: 'title', message: 'required' }],
				},
			},
			{ status: 422 },
		),
	);

	const error = (await requestApi('/posts', { method: 'POST', body: '{}' }).catch(
		(caught: unknown) => caught,
	)) as ApiError;

	expect(error).toBeInstanceOf(ApiError);
	expect(error.status).toBe(422);
	expect(error.code).toBe('VALIDATION');
	expect(error.fields).toEqual([{ path: 'title', message: 'required' }]);
});

test('a 401 is recognizable as an expired session', async () => {
	stubFetch(
		Response.json(
			{
				success: false,
				data: null,
				error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
			},
			{ status: 401 },
		),
	);

	const error = (await requestApi('/posts').catch((caught: unknown) => caught)) as ApiError;

	expect(error.isUnauthorized).toBe(true);
});

test('a non-JSON body is reported as an internal error instead of throwing a parse error', async () => {
	stubFetch(
		new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
	);

	const error = (await requestApi('/posts').catch((caught: unknown) => caught)) as ApiError;

	expect(error).toBeInstanceOf(ApiError);
	expect(error.code).toBe('INTERNAL');
	expect(error.status).toBe(502);
});
