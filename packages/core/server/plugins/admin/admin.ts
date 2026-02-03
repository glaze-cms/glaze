import { Elysia } from 'elysia';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { GlazeInternalConfig } from '../../validators/config/config';

type HandleAdminParams = {
	request: Request;
	path: string;
	adminPrefix: string;
};

/**
 * Normalizes a path prefix to always start with /
 */
function normalizePrefix(prefix: string): string {
	return prefix.startsWith('/') ? prefix : `/${prefix}`;
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
			// Vite dev server is configured with base: '/admin/', so we need to
			// translate the custom admin prefix to '/admin' when proxying
			const vitePath = path.replace(adminPrefix, '/admin');
			const target = `http://localhost:5173${vitePath}${viteUrl.search}`;

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
 * Elysia plugin that registers admin dashboard routes.
 *
 * Registers:
 * - Routes at `{adminPrefix}/*` and `{adminPrefix}` for the configured prefix
 * - Fallback routes at `/admin/*` and `/admin` when using Vite dev proxy with custom prefix
 *
 * @param config - The Glaze internal configuration
 * @returns An Elysia plugin with all admin routes registered
 */
export const adminPlugin = (config: GlazeInternalConfig) => {
	// Normalize prefix once at plugin entry to ensure routes match
	const adminPrefix = normalizePrefix(config.adminPrefix);
	const app = new Elysia({ name: '@glaze/admin' });
	const adminRoute = `${adminPrefix}/*`;

	// Determine if we need Vite fallback routes
	// In dev with a custom admin prefix, we need to fallback to /admin for Vite assets
	const isDevProxy = process.env.GLAZE_INTERNAL__ADMIN_PROXY === 'true';
	const needsViteFallback = isDevProxy && adminPrefix !== '/admin';

	// Register primary admin routes for the configured prefix
	app
		.all(adminRoute, ({ request, path }) =>
			handleAdmin({ request, path, adminPrefix }),
		)
		.all(adminPrefix, ({ request, path }) =>
			handleAdmin({ request, path, adminPrefix }),
		);

	// Register fallback routes for Vite dev server when using custom prefix
	if (needsViteFallback) {
		app
			.all('/admin/*', ({ request, path }) =>
				handleAdmin({ request, path, adminPrefix: '/admin' }),
			)
			.all('/admin', ({ request, path }) =>
				handleAdmin({ request, path, adminPrefix: '/admin' }),
			);
	}

	return app;
};
