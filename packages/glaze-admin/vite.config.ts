import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The Glaze backend origin in dev (the Bun/Elysia server). Override with GLAZE_API_ORIGIN. */
const apiOrigin = process.env['GLAZE_API_ORIGIN'] ?? 'http://localhost:4000';

// The admin is served under `/admin` (both by Vite in dev and by the Glaze server in prod), so assets
// resolve relative to that base. Dev: Vite serves the admin with HMR and proxies backend paths to the Bun
// server (one origin, no CORS). Prod: `bun run build` emits into the glaze-cms package's `admin-dist`,
// which the Glaze server serves in-process at `/admin`.
export default defineConfig({
	base: '/admin/',
	plugins: [react()],
	build: {
		outDir: '../glaze-cms/admin-dist',
		emptyOutDir: true,
	},
	server: {
		// Pin the port: GLAZE_ADMIN_DEV_URL points at 5173, so fail loudly if it's taken rather than
		// silently drifting to 5174+ (which would break the Glaze dev proxy).
		port: 5173,
		strictPort: true,
		// When the admin is reached through the Glaze server's dev proxy, the page loads from the Glaze
		// origin but Vite's HMR socket must still connect to Vite directly on 5173.
		hmr: { clientPort: 5173 },
		proxy: {
			'/api': { target: apiOrigin, changeOrigin: true },
			'/_health': { target: apiOrigin, changeOrigin: true },
		},
	},
});
