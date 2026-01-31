import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { GlazeEnv } from '../../validators/env';

type HandleAdminParams = {
	env: GlazeEnv;
	request: Request;
	path: string;
};

/**
 * Elysia handler that mounts the Admin UI.
 *
 * Behavior:
 * - In local development (`NODE_ENV === 'local'`), proxies all `/admin/*`
 *   requests to a Vite dev server (default: http://localhost:5173),
 *   enabling HMR and fast feedback.
 * - In non-local environments, serves the prebuilt Admin SPA from
 *   `packages/admin/dist`.
 * - Redirects `/admin` → `/admin/` to ensure correct relative asset loading.
 * - Prevents path traversal outside the admin dist directory.
 *
 * Notes:
 * - Relies on Elysia's ability to return `Bun.file()` directly as a response.
 * - Intended for Bun + Elysia runtimes; not a generic Fetch handler.
 *
 * @param request - The incoming Request object
 * @param path - The matched path for the admin route
 * @param env - Glaze environment configuration
 * @returns A proxied response from Vite (dev) or a static admin asset / SPA entry (prod)
 */
export async function handleAdmin({ request, path }: HandleAdminParams) {
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

	if (path === '/admin') {
		return Response.redirect('/admin/', 301);
	}

	const relativePath = path.replace(/^\/admin/, '');

	const filePath =
		!relativePath || relativePath === '/'
			? 'index.html'
			: relativePath.replace(/^\//, '');

	const adminEntry = import.meta.resolve('@glaze/admin');
	const adminRoot = dirname(fileURLToPath(adminEntry));
	const dist = resolve(adminRoot, 'dist');
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
}
