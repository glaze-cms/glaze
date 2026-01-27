import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
	base: '/admin/', // Essential for proxying under /admin prefix
	server: {
		port: 5173,
		host: true, // Listen on all addresses (0.0.0.0)
		strictPort: true,
		proxy: {
			'/api': {
				target: 'http://localhost:4000',
				changeOrigin: true,
			},
		},
	},
	plugins: [
		tailwindcss(),
		react({
			babel: {
				plugins: [['babel-plugin-react-compiler']],
			},
		}),
	],
});
