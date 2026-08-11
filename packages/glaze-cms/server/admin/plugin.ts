/**
 * Serves the Admin UI at the admin prefix from Glaze's own origin — so it shares the API's session
 * cookies and satisfies the strict `default-src 'self'` CSP with no relaxation. The app is based at
 * `${prefix}/` (Vite's `base` and the built asset paths), so the exact bare prefix redirects there; the
 * subtree is then handled by one of two modes:
 *
 * - **Dev** (when a dev server is configured, via `GLAZE_ADMIN_DEV_URL` or the `devUrl` option): proxies
 *   the admin subtree to a running Vite dev server, so the admin has HMR and needs **no build**. Vite's
 *   `base` is `${prefix}/`, so its client/module/HMR paths all sit under the prefix and one proxy covers them.
 * - **Prod** (no dev server): serves the pre-built bundle from `<package>/admin-dist` (emitted by
 *   `packages/glaze-admin`'s `vite build`) through the runtime seam (`Bun.file` / `node:fs`), with SPA
 *   fallback to `index.html` and path-traversal refused. When the bundle is absent, admin routes answer 404.
 */

import { join, normalize, sep } from 'node:path';

import { Elysia } from 'elysia';

import type { GlazeContext } from '../app/context.ts';
import type { HTTPHeaders } from 'elysia';

/** The default bundle location — `<glaze-cms package root>/admin-dist`. */
const DEFAULT_ADMIN_DIST = join(import.meta.dirname, '..', '..', 'admin-dist');

/** The Vite dev-server origin used when dev mode is turned on with a bare flag rather than a URL. */
const DEFAULT_ADMIN_DEV_URL = 'http://localhost:5173';

/** File extension → response content-type; anything else is served as a generic binary stream. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.txt': 'text/plain; charset=utf-8',
};

/** Options for {@link createAdminPlugin}. */
export interface AdminPluginOptions {
	/** The built bundle directory (defaults to the package's `admin-dist`). */
	readonly distRoot?: string;
	/**
	 * Turns on dev mode, where the plugin proxies the admin to a running Vite dev server (HMR, no build)
	 * instead of serving the built bundle. Accepts either a truthy flag (`'true'`/`'1'`) to use the
	 * default Vite origin (`http://localhost:5173`), or an explicit origin to override the port (e.g.
	 * `'http://localhost:5180'`). Defaults to the `GLAZE_ADMIN_DEV_URL` environment variable.
	 */
	readonly devUrl?: string;
}

/**
 * Resolves the Vite dev-server origin from the raw option/env value. A truthy flag (`true`/`1`/`yes`/`on`)
 * selects the default Vite origin; an explicit URL is used as-is; a falsy flag or empty value disables dev
 * mode. This lets `GLAZE_ADMIN_DEV_URL=true` turn on the proxy without having to know the port.
 *
 * @param raw - The configured value (option or environment variable), if any.
 * @returns The dev-server origin to proxy to, or `undefined` when dev mode is off.
 */
function resolveDevUrl(raw: string | undefined): string | undefined {
	const value = raw?.trim();
	if (!value) return undefined;
	if (/^(true|1|yes|on)$/i.test(value)) return DEFAULT_ADMIN_DEV_URL;
	if (/^(false|0|no|off)$/i.test(value)) return undefined;
	return value;
}

/**
 * Resolves the response content-type for a file path from its extension.
 *
 * @param path - The file path.
 * @returns The content-type header value.
 */
function contentTypeFor(path: string): string {
	const dot = path.lastIndexOf('.');
	const ext = dot === -1 ? '' : path.slice(dot).toLowerCase();
	return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Joins a request-relative path under the bundle root, refusing any result that escapes it (path
 * traversal via `..`).
 *
 * @param root - The bundle root directory.
 * @param relative - The request path relative to the admin prefix.
 * @returns The absolute file path, or `null` when it would escape the root.
 */
function resolveWithinRoot(root: string, relative: string): string | null {
	const full = normalize(join(root, relative));
	if (full !== root && !full.startsWith(root + sep)) return null;
	return full;
}

/**
 * Forwards a request to the Vite dev server, preserving method/headers/body.
 *
 * @param request - The incoming request.
 * @param baseUrl - The Vite dev-server origin.
 * @returns Vite's response, or a 502 when it is unreachable.
 */
async function proxyToVite(request: Request, baseUrl: string): Promise<Response> {
	const { pathname, search } = new URL(request.url);
	const init: RequestInit = {
		method: request.method,
		headers: request.headers,
		redirect: 'manual',
	};
	if (request.body) {
		init.body = request.body;
		(init as { duplex?: 'half' }).duplex = 'half';
	}
	try {
		return await fetch(`${baseUrl}${pathname}${search}`, init);
	} catch {
		return new Response(
			`Vite dev server not reachable at ${baseUrl}. Is \`bun run dev\` running in packages/glaze-admin?`,
			{ status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } },
		);
	}
}

/**
 * Builds the admin-serving plugin.
 *
 * @param context - The Glaze context (resolved options + runtime seam).
 * @param options - Bundle directory and/or Vite dev-server URL (see {@link AdminPluginOptions}).
 * @returns An Elysia plugin serving the Admin UI at `options.prefixes.admin`.
 */
export function createAdminPlugin(context: GlazeContext, options: AdminPluginOptions = {}) {
	const { options: resolved, runtime } = context;
	const prefix = resolved.prefixes.admin;
	const devUrl = resolveDevUrl(options.devUrl ?? process.env['GLAZE_ADMIN_DEV_URL']);
	const distRoot = options.distRoot ?? DEFAULT_ADMIN_DIST;
	const devCsp = devUrl ? buildDevCsp(devUrl) : null;

	// The admin app lives under `${prefix}/` — Vite's `base` and the built asset paths. So the exact bare
	// prefix redirects to the trailing-slash form; everything under it is proxied (dev) or served (prod).
	// Both the bare route and the subtree route dispatch here, deciding from the *real* request path rather
	// than which route matched — so this is independent of Elysia's trailing-slash normalization and can't
	// loop (a `${prefix}/` request never re-enters the redirect branch).
	const dispatch = (request: Request, headers: HTTPHeaders): Promise<Response> | Response => {
		// Dev only: override the app's strict `default-src 'self'` for the admin subtree. Vite's dev client
		// uses inline scripts, eval, and an HMR websocket to the Vite origin — all otherwise blocked. Mutating
		// `set.headers` overrides the global security-header default for these routes; prod stays strict.
		if (devCsp) headers['content-security-policy'] = devCsp;
		const pathname = new URL(request.url).pathname;
		if (pathname === prefix)
			return new Response(null, { status: 302, headers: { location: `${prefix}/` } });
		if (devUrl) return proxyToVite(request, devUrl);
		return serveStatic(runtime, distRoot, prefix, pathname);
	};

	const handler = ({
		request,
		set,
	}: {
		request: Request;
		set: { headers: HTTPHeaders };
	}): Promise<Response> | Response => dispatch(request, set.headers);
	return new Elysia({ name: 'glaze.admin' }).all(prefix, handler).all(`${prefix}/*`, handler);
}

/**
 * Builds the relaxed dev-mode CSP for the admin subtree. Allows Vite's inline scripts and `eval`, inline
 * styles, and connections to the Vite dev origin over both HTTP (module requests) and WebSocket (HMR).
 *
 * @param devUrl - The Vite dev-server origin (e.g. `http://localhost:5173`).
 * @returns The `Content-Security-Policy` header value for admin dev responses.
 */
function buildDevCsp(devUrl: string): string {
	const httpOrigin = devUrl.replace(/\/+$/, '');
	const wsOrigin = httpOrigin.replace(/^http/, 'ws');
	return [
		"default-src 'self'",
		"script-src 'self' 'unsafe-inline' 'unsafe-eval'",
		"style-src 'self' 'unsafe-inline'",
		`connect-src 'self' ${httpOrigin} ${wsOrigin}`,
		"img-src 'self' data:",
		"font-src 'self' data:",
	].join('; ');
}

/**
 * Serves a file from the built admin bundle through the runtime seam, with SPA fallback to `index.html`
 * and path traversal refused. When the bundle is absent, answers 404 with a build hint.
 *
 * @param runtime - The runtime seam (its `readBytes` reads the file).
 * @param distRoot - The built bundle directory.
 * @param prefix - The admin prefix, stripped to derive the bundle-relative path.
 * @param pathname - The request path.
 * @returns The file response, the SPA index, or a 404 when nothing is built.
 */
async function serveStatic(
	runtime: GlazeContext['runtime'],
	distRoot: string,
	prefix: string,
	pathname: string,
): Promise<Response> {
	const readOrNull = async (path: string): Promise<Uint8Array | null> => {
		try {
			return await runtime.readBytes(path);
		} catch {
			return null;
		}
	};

	const relative = pathname.slice(prefix.length).replace(/^\/+/, '');
	if (relative) {
		const file = resolveWithinRoot(distRoot, relative);
		if (file) {
			const bytes = await readOrNull(file);
			if (bytes) return new Response(bytes, { headers: { 'content-type': contentTypeFor(file) } });
		}
	}
	// SPA fallback: any unmatched app route serves index.html so client-side routing works.
	const index = await readOrNull(join(distRoot, 'index.html'));
	if (index)
		return new Response(index, { headers: { 'content-type': 'text/html; charset=utf-8' } });
	return new Response(
		'The Glaze Admin UI is not built. Run `bun run build` in packages/glaze-admin.',
		{
			status: 404,
			headers: { 'content-type': 'text/plain; charset=utf-8' },
		},
	);
}
