import { afterEach, expect, mock, spyOn, test } from 'bun:test';

import { getManifest, loadManifest } from './config.ts';

afterEach(() => {
	mock.restore();
});

/**
 * Replaces `fetch` with a stub for one test.
 *
 * @param response - What the stub should resolve to.
 * @returns The spy, so call counts can be asserted.
 */
function stubFetch(response: Response) {
	return spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

// These run in order on purpose: the module caches the manifest, so the un-cached cases must come first.

test('getManifest returns the server defaults before anything is loaded', () => {
	expect(getManifest()).toEqual({
		name: 'glaze',
		apiPrefix: '/api',
		adminPrefix: '/admin',
		healthPath: '/_health',
	});
});

test('loadManifest throws when the server answers with an error status', async () => {
	stubFetch(new Response('nope', { status: 503 }));

	const error = await loadManifest().catch((caught: unknown) => caught);

	expect(error).toBeInstanceOf(Error);
	expect((error as Error).message).toContain('503');
});

test('a partial manifest is filled in from the defaults rather than yielding undefined prefixes', async () => {
	stubFetch(Response.json({ name: 'glaze', adminPrefix: '/panel' }));

	const manifest = await loadManifest();

	expect(manifest.adminPrefix).toBe('/panel');
	expect(manifest.apiPrefix).toBe('/api');
	expect(manifest.healthPath).toBe(null);
});

test('the manifest is fetched once and served from cache afterwards', async () => {
	const stub = stubFetch(Response.json({ name: 'glaze', apiPrefix: '/ignored' }));

	await loadManifest();

	expect(stub).toHaveBeenCalledTimes(0);
	expect(getManifest().adminPrefix).toBe('/panel');
});
