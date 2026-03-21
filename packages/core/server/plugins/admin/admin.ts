import { Elysia } from 'elysia';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { GlazeInternalConfig } from '@glaze/config';

type HandleAdminParams = {
	request: Request;
	path: string;
	adminPrefix: string;
};

/**
 * Normalizes a path prefix to always start with / and removes trailing slashes
 */
function normalizePrefix(prefix: string): string {
	let normalized = prefix.startsWith('/') ? prefix : `/${prefix}`;
	// Remove trailing slash to ensure consistent route matching
	normalized = normalized.replace(/\/$/, '');
	// Handle edge case: root path should remain "/"
	return normalized || '/';
}

/**
 * Elysia handler that mounts the Admin UI.
 *
 * Behavior:
 * - In local development (`NODE_ENV === 'local'`), proxies all requests to
 *   the configured admin prefix to a Vite dev server (default: http://localhost:5173),
 *   enabling HMR and fast feedback.
 * - In non-local environments, serves the prebuilt Admin SPA from
 *   `packages/admin/dist`.
 * - Redirects `{adminPrefix}` → `{adminPrefix}/` to ensure correct relative asset loading.
 * - Prevents path traversal outside the admin dist directory.
 *
 * Notes:
 * - Relies on Elysia's ability to return `Bun.file()` directly as a response.
 * - Intended for Bun + Elysia runtimes; not a generic Fetch handler.
 *
 * @param request - The incoming Request object
 * @param path - The matched path for the admin route
 * @param adminPrefix - The configured admin prefix (e.g., '/admin' or '/administrador')
 * @returns A proxied response from Vite (dev) or a static admin asset / SPA entry (prod)
 */
async function handleAdmin({ request, path, adminPrefix }: HandleAdminParams) {
	try {
		// Redirect {prefix} → {prefix}/ for asset loading
		if (path === adminPrefix) {
			return Response.redirect(`${adminPrefix}/`, 301);
		}

		if (process.env.GLAZE_INTERNAL__ADMIN_PROXY === 'true') {
			const viteUrl = new URL(request.url);
			const target = `http://localhost:5173${path}${viteUrl.search}`;

			try {
				return await fetch(target, {
					method: request.method,
					headers: request.headers,
					body: request.body,
				});
			} catch {
				return new Response(
					'Vite Dev Server Not Ready. Is it running on port 5173?',
					{ status: 502 },
				);
			}
		}

		// Remove the admin prefix to get the relative path
		const relativePath = path.replace(adminPrefix, '');

		const filePath =
			!relativePath || relativePath === '/'
				? 'index.html'
				: relativePath.replace(/^\//, '');

		const adminEntry = import.meta.resolve('@glaze/admin');
		const dist = dirname(fileURLToPath(adminEntry));
		const resolvedDistPath = resolve(dist, filePath);

		// Prevent path traversal
		if (!resolvedDistPath.startsWith(dist + sep)) {
			return new Response('Not found', { status: 404 });
		}

		const adminBuild = Bun.file(resolvedDistPath);

		if (!(await adminBuild.exists())) {
			return new Response('Not found', { status: 404 });
		}

		return adminBuild;
	} catch (error) {
		// eslint-disable-next-line no-console -- Error handler at system boundary, console is acceptable
		console.error('Admin handler error:', error);
		return new Response('Internal Server Error', { status: 500 });
	}
}

/**
 * Proxies a request directly to the Vite dev server at localhost:5173.
 * Used for Vite-internal paths (runtime client, HMR, source files) that Vite
 * injects as root-absolute URLs into the served HTML.
 */
async function proxyToVite(request: Request, path: string) {
	const viteUrl = new URL(request.url);
	const target = `http://localhost:5173${path}${viteUrl.search}`;

	try {
		return await fetch(target, {
			method: request.method,
			headers: request.headers,
			body: request.body,
		});
	} catch {
		return new Response('Vite Dev Server Not Ready. Is it running on port 5173?', {
			status: 502,
		});
	}
}

/**
 * Elysia plugin that registers admin dashboard routes.
 *
 * Registers:
 * - `GET {adminPrefix}/config` — public endpoint returning server config for the admin SPA
 * - Routes at `{adminPrefix}/*` and `{adminPrefix}` for the configured prefix
 * - When `GLAZE_INTERNAL__ADMIN_PROXY=true`, also proxies Vite-internal paths
 *   (`/@vite/*`, `/@react-refresh`, `/@fs/*`, `/@id/*`, `/src/*`) so the browser
 *   can reach the Vite dev server runtime through the core server.
 *
 * @param config - The Glaze internal configuration
 * @returns An Elysia plugin with all admin routes registered
 */
export const adminPlugin = (config: GlazeInternalConfig) => {
	// Normalize prefix once at plugin entry to ensure routes match
	const adminPrefix = normalizePrefix(config.adminPrefix);
	const app = new Elysia({ name: '@glaze/admin' });
	const adminRoute = `${adminPrefix}/*`;

	// Public config endpoint — consumed by the admin SPA on startup to learn
	// server-side settings (e.g. apiPrefix) without hardcoding them into the frontend build
	app.get(`${adminPrefix}/config`, () => ({ apiPrefix: config.apiPrefix, adminPrefix }));

	// Register primary admin routes for the configured prefix
	app
		.all(adminRoute, ({ request, path }) =>
			handleAdmin({ request, path, adminPrefix }),
		)
		.all(adminPrefix, ({ request, path }) =>
			handleAdmin({ request, path, adminPrefix }),
		);

	// In dev proxy mode, Vite injects its runtime scripts (/@vite/client, /@react-refresh,
	// /src/main.tsx, etc.) as root-absolute URLs. The browser resolves these against the
	// core server's origin, so we must forward them to Vite.
	if (process.env.GLAZE_INTERNAL__ADMIN_PROXY === 'true') {
		app
			.all('/@vite/*', ({ request, path }) => proxyToVite(request, path))
			.all('/@react-refresh', ({ request, path }) => proxyToVite(request, path))
			.all('/@fs/*', ({ request, path }) => proxyToVite(request, path))
			.all('/@id/*', ({ request, path }) => proxyToVite(request, path))
			.all('/src/*', ({ request, path }) => proxyToVite(request, path))
			.all('/gen/*', ({ request, path }) => proxyToVite(request, path))
			.all('/node_modules/.vite/*', ({ request, path }) => proxyToVite(request, path));
	}

	return app;
};
