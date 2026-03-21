import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import svgr from 'vite-plugin-svgr';
import babel from '@rolldown/plugin-babel';
import tsconfigPaths from 'vite-tsconfig-paths';

// https://vite.dev/config/
export default defineConfig({
	base: './',
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
		tanstackRouter({
			target: 'react',
			autoCodeSplitting: true,
			generatedRouteTree: 'gen/tree.ts',
		}),
		svgr(),
		react(),
		tsconfigPaths(),
		babel({ presets: [reactCompilerPreset()] }),
	],
});
