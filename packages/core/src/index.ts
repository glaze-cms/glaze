import { Elysia } from 'elysia';
import { validateEnv } from '@glaze/core/server/validators';
import { createLogger } from '@glaze/logger';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, sep } from 'node:path';

export function glaze() {
	const logger = createLogger({ name: 'GLAZE' });

	/* Parse and validate environment variables */
	validateEnv(logger);

	// ../../ resolves to the 'packages' directory
	const currentDir = dirname(fileURLToPath(import.meta.url));
	const packagesRoot = resolve(currentDir, '../../');
	const port = process.env.PORT ? parseInt(process.env.PORT) : 4000;

	const app = new Elysia()
		.get('/api/health', () => ({
			status: 'ok',
			message: 'Glaze server is running.',
		}))
		.all('/admin*', async ({ request, path }) => {
			// Development: Proxy to Vite
			if (process.env.NODE_ENV !== 'production') {
				const viteUrl = new URL(request.url);
				// rewrite port to 5173 and keep path
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

			// Production: Serve Static Vite Build
			// Handle /admin -> /admin/ redirect
			if (path === '/admin') {
				return Response.redirect('/admin/', 301);
			}

			const relative = path.replace(/^\/admin/, '');
			// If empty or slash, serve index.html
			const filePath =
				!relative || relative === '/'
					? 'index.html'
					: relative.replace(/^\//, '');

			const assetsRoot = resolve(packagesRoot, 'admin/dist');
			const resolvedPath = resolve(assetsRoot, filePath);

			// Security Check: Prevent path traversal
			if (!resolvedPath.startsWith(assetsRoot + sep)) {
				return new Response('Not found', { status: 404 });
			}

			return Bun.file(resolvedPath);
		})
		.get('/', () => ({ status: 'ok', message: 'Glaze server is running' }))
		.listen(port);

	return app;
}
