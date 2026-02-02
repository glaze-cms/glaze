import type { CORSConfig } from '@elysiajs/cors';

export interface SecurityConfig {
	cors: {
		/**
		 * Control which websites can access your API from a browser.
		 *
		 * **When do I need this?**
		 *
		 * ✅ **You DON'T need to configure this if:**
		 * - You're using the built-in Glaze Admin UI (served from the same domain/port)
		 * - You only access your API from server-side code
		 *
		 * ⚠️ **You NEED to configure this if:**
		 * - Your frontend is on a different domain (e.g., `myapp.com` → `api.myapp.com`)
		 * - Your frontend is on a different port (e.g., `localhost:3000` → `localhost:4000`)
		 * - You're building a separate React/Vue/Next.js app that calls your Glaze API
		 *
		 * **Configuration Options:**
		 * - `"https://mysite.com"` - Allow a single specific website
		 * - `["https://mysite.com", "https://app.mysite.com"]` - Allow multiple specific websites
		 * - `true` - Allow ALL websites (⚠️ development only, never use in production!)
		 * - `RegExp` - Pattern matching (e.g., `/\.mysite\.com$/` matches all subdomains)
		 * - `Function` - Custom validation logic for dynamic control
		 *
		 * @default true in development (allows all origins), false in production (disallows all origins)
		 *
		 * @example
		 * ```typescript
		 * // Production: Allow your frontend app
		 * origin: ['https://myapp.com']
		 *
		 * // Development: Allow local dev server
		 * origin: ['http://localhost:3000']
		 *
		 * // Development: Allow all (quick testing)
		 * origin: true
		 *
		 * // Advanced: Allow all subdomains
		 * origin: /\.myapp\.com$/
		 * ```
		 */
		origin?: CORSConfig['origin'];

		/**
		 * HTTP methods allowed for CORS.
		 * @default ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
		 */
		methods?: CORSConfig['methods'];

		/**
		 * HTTP headers allowed for CORS.
		 * @default ["Content-Type", "Authorization"]
		 */
		allowedHeaders?: CORSConfig['allowedHeaders'];
	};
}
