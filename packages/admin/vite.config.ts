import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

// https://vite.dev/config/
export default defineConfig({
	base: '/admin/',
	server: {
		port: 5173,
		host: true,
		strictPort: true,
		hmr: {
			host: 'localhost',
			port: 5173,
		},
		proxy: {
			'/api': {
				target: 'http://localhost:4000',
				changeOrigin: true,
			},
		},
	},
	plugins: [
		tsconfigPaths(),
		tanstackRouter({
			target: 'react',
			autoCodeSplitting: true,
			generatedRouteTree: 'gen/tree.ts',
		}),
		react({
			babel: {
				plugins: [['babel-plugin-react-compiler']],
			},
		}),
	],
});
