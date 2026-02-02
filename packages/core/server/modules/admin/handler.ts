import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
export async function handleAdmin({
	request,
	path,
	adminPrefix,
}: HandleAdminParams) {
	const normalizedPrefix = normalizePrefix(adminPrefix);

	try {
		// Redirect {prefix} → {prefix}/ for asset loading
		if (path === normalizedPrefix) {
			return Response.redirect(`${normalizedPrefix}/`, 301);
		}

		if (process.env.GLAZE_INTERNAL__ADMIN_PROXY === 'true') {
			const viteUrl = new URL(request.url);
			// Vite dev server is configured with base: '/admin/', so we need to
			// translate the custom admin prefix to '/admin' when proxying
			const vitePath = path.replace(normalizedPrefix, '/admin');
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
		const relativePath = path.replace(normalizedPrefix, '');

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
