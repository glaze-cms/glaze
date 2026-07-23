import { expect, test } from '#harness';

import { resolveOptions } from './resolver.ts';

test('resolveOptions applies the default prefixes and health config', () => {
	const resolved = resolveOptions();
	expect(resolved.prefixes.api).toBe('/api');
	expect(resolved.prefixes.admin).toBe('/admin');
	expect(resolved.health.enabled).toBe(true);
	expect(resolved.health.path).toBe('/_health');
});

test('resolveOptions normalizes prefixes (leading slash added, trailing stripped)', () => {
	const resolved = resolveOptions({ prefixes: { api: 'v1/', admin: '/panel/' } });
	expect(resolved.prefixes.api).toBe('/v1');
	expect(resolved.prefixes.admin).toBe('/panel');
});

test('resolveOptions honors an explicit port and merges CSP onto the secure baseline', () => {
	const resolved = resolveOptions({
		port: 8080,
		security: { headers: { csp: { 'img-src': "'self' data:" } } },
	});
	expect(resolved.port).toBe(8080);
	// user directive is added…
	expect(resolved.security.headers.csp['img-src']).toBe("'self' data:");
	// …without dropping the locked baseline
	expect(resolved.security.headers.csp['default-src']).toBe("'self'");
});

test('resolveOptions LOCKS the CSP baseline — a user cannot weaken a protected directive', () => {
	const resolved = resolveOptions({
		security: { headers: { csp: { 'default-src': "* 'unsafe-inline' 'unsafe-eval'" } } },
	});
	// the attempted override is ignored; the locked value wins
	expect(resolved.security.headers.csp['default-src']).toBe("'self'");
});

test('resolveOptions rejects a root prefix or equal api/admin prefixes', () => {
	expect(() => resolveOptions({ prefixes: { api: '/' } })).toThrow();
	expect(() => resolveOptions({ prefixes: { api: '/x', admin: '/x' } })).toThrow();
});
