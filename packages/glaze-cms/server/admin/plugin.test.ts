import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Elysia } from 'elysia';

import { expect, test } from '#harness';
import { resolveRuntime } from '#runtime';

import { resolveOptions } from '../options/index.ts';
import { createAdminPlugin } from './plugin.ts';

// Contract/HTTP tier: static-asset serving touches no database, so a minimal context stands in. Reading
// goes through the runtime seam, so this runs identically on both runtimes without the matrix.

/** A minimal context — the admin plugin only reads `options.prefixes.admin` and `runtime`. */
function context() {
	return { options: resolveOptions({}), runtime: resolveRuntime() } as unknown as Parameters<
		typeof createAdminPlugin
	>[0];
}

/** Mounts the admin plugin over a given bundle directory (static mode). */
function mount(distRoot: string): { handle(r: Request): Promise<Response> } {
	return new Elysia().use(createAdminPlugin(context(), { distRoot }));
}

/** GETs a path and returns the Response. */
function get(app: { handle(r: Request): Promise<Response> }, path: string): Promise<Response> {
	return app.handle(new Request(`http://localhost${path}`));
}

/** Creates a temp bundle dir with the given files (relative path → contents). */
function bundle(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), 'glaze-admin-'));
	for (const [rel, contents] of Object.entries(files)) {
		const full = join(dir, rel);
		mkdirSync(join(full, '..'), { recursive: true });
		writeFileSync(full, contents);
	}
	return dir;
}

test('redirects the bare admin prefix to the trailing-slash form (where the app is based)', async () => {
	const dir = bundle({ 'index.html': '<!doctype html><title>Admin</title>' });
	try {
		const response = await get(mount(dir), '/admin');
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('/admin/');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('serves index.html at the trailing-slash admin root', async () => {
	const dir = bundle({ 'index.html': '<!doctype html><title>Admin</title>' });
	try {
		const response = await get(mount(dir), '/admin/');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/html');
		expect(await response.text()).toContain('Admin');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('serves a nested asset with the right content-type', async () => {
	const dir = bundle({ 'index.html': '<!doctype html>', 'assets/app.js': 'console.log(1)' });
	try {
		const response = await get(mount(dir), '/admin/assets/app.js');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/javascript');
		expect(await response.text()).toContain('console.log');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('falls back to index.html for an unknown app route (SPA routing)', async () => {
	const dir = bundle({ 'index.html': '<!doctype html><title>SPA</title>' });
	try {
		const response = await get(mount(dir), '/admin/posts/123/edit');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/html');
		expect(await response.text()).toContain('SPA');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('answers 404 with a build hint when the bundle is missing', async () => {
	const response = await get(mount(join(tmpdir(), 'glaze-admin-absent-xyz')), '/admin/');
	expect(response.status).toBe(404);
	expect(await response.text()).toContain('not built');
});

test('proxies to the Vite dev server in dev mode (502 when it is unreachable)', async () => {
	// A closed port stands in for a not-yet-started Vite server; the request is proxied, not served.
	const app = new Elysia().use(createAdminPlugin(context(), { devUrl: 'http://localhost:1' }));
	const response = await get(app, '/admin/src/main.tsx');
	expect(response.status).toBe(502);
	expect(await response.text()).toContain('Vite dev server not reachable');
});

test('a falsy dev flag disables dev mode and serves the built bundle', async () => {
	const dir = bundle({ 'index.html': '<!doctype html><title>Admin</title>' });
	try {
		// `'false'` is a flag, not a URL: it must turn dev mode OFF (static serving), not be used as a
		// proxy target — proving the flag/URL coercion runs.
		const app = new Elysia().use(createAdminPlugin(context(), { devUrl: 'false', distRoot: dir }));
		const response = await get(app, '/admin/');
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('Admin');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('relaxes the CSP for the admin subtree in dev mode (Vite HMR + inline scripts)', async () => {
	// The closed port only proves the header is set regardless of proxy outcome; the CSP is what matters.
	const app = new Elysia().use(createAdminPlugin(context(), { devUrl: 'http://localhost:6199' }));
	const response = await get(app, '/admin/');
	const csp = response.headers.get('content-security-policy') ?? '';
	expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
	// The HMR websocket connects to the Vite origin directly, so connect-src must allow its ws:// form.
	expect(csp).toContain('ws://localhost:6199');
});

test('does not relax the CSP in prod (static) mode — the app-wide strict policy applies', async () => {
	const dir = bundle({ 'index.html': '<!doctype html>' });
	try {
		const response = await get(mount(dir), '/admin/');
		expect(response.headers.get('content-security-policy')).toBe(null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
