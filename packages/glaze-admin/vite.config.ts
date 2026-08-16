import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';

// Where the Glaze server lives when the admin is opened directly on :5173. The supported dev flow is to
// browse the glaze origin (`/admin`), which proxies here — these entries only cover the direct-open case.
const apiOrigin = process.env['GLAZE_API_ORIGIN'] ?? 'http://localhost:4000';

export default defineConfig({
	base: '/admin/',
	plugins: [
		tanstackRouter({
			target: 'react',
			routesDirectory: 'src/routes',
			generatedRouteTree: 'gen/tree.ts',
			autoCodeSplitting: true,
		}),
		react(),
		svgr(),
	],
	// Vite resolves the tsconfig `paths` map natively, so `@/…` and `@assets/…` need no plugin.
	resolve: { tsconfigPaths: true },
	build: { outDir: '../glaze-cms/admin-dist', emptyOutDir: true },
	server: {
		port: 5173,
		strictPort: true,
		hmr: { clientPort: 5173 },
		proxy: {
			'/api': { target: apiOrigin, changeOrigin: true },
			'/_health': { target: apiOrigin, changeOrigin: true },
		},
	},
});
