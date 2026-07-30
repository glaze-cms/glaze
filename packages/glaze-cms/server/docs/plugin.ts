/**
 * The API reference docs plugin: serves an OpenAPI document generated from the content routes' TypeBox
 * schemas, rendered by Scalar (default) or Swagger UI via `@elysiajs/openapi`.
 *
 * The UI bundle loads from a CDN (jsdelivr/unpkg): the only npm route to Scalar's prebuilt bundle pulls
 * ~560 transitive packages onto every install, so we don't take that weight. To keep the global CSP
 * (`default-src 'self'`) intact everywhere else, the strict policy is overridden **only on the docs
 * path** with a relaxation that permits the CDN plus the inline script/style the UIs inject. The
 * self-host alternative is tracked in LEA-10. Better Auth's routes are excluded from the spec.
 */

import { openapi } from '@elysiajs/openapi';
import { Elysia } from 'elysia';

import type { ResolvedGlazeOptions } from '../options/index.ts';

/** Route-scoped CSP for the docs path only — permits the reference-UI CDNs and their inline bootstrap. */
const DOCS_CSP = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com",
	"style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com",
	"img-src 'self' data: https://cdn.jsdelivr.net https://unpkg.com",
	"font-src 'self' data:",
	"connect-src 'self'",
	"worker-src 'self' blob:",
].join('; ');

/**
 * Builds the API-docs plugin.
 *
 * @param docs - The resolved docs config (enabled/path/provider + UI/metadata pass-through).
 * @param apiPrefix - The API mount prefix, used to exclude the auth routes from the spec.
 * @returns An Elysia plugin serving the docs UI + spec, or an empty plugin when disabled.
 */
export function createDocsPlugin(docs: ResolvedGlazeOptions['docs'], apiPrefix: string) {
	const plugin = new Elysia({ name: 'glaze.docs' });
	if (!docs.enabled) return plugin;

	// Both reference UIs are CDN-loaded Scalar pages: our content docs at `docs.path`, and Better Auth's
	// own auth reference at `{apiPrefix}/auth/reference` (enabled alongside via the same docs toggle).
	const relaxPaths = [docs.path, `${apiPrefix}/auth/reference`];

	return plugin
		.onRequest(({ request, set }) => {
			// Override the global strict CSP with the relaxed one, but only on the docs surfaces.
			const { pathname } = new URL(request.url);
			if (relaxPaths.some((base) => pathname === base || pathname.startsWith(`${base}/`))) {
				set.headers['content-security-policy'] = DOCS_CSP;
			}
		})
		.use(
			openapi({
				enabled: true,
				path: docs.path,
				provider: docs.provider === 'swagger' ? 'swagger-ui' : 'scalar',
				// `exclude.paths` matches route paths by EXACT string (Array.includes, not RegExp — the
				// type is misleading), so list Better Auth's two registered catch-all paths verbatim.
				exclude: { paths: [`${apiPrefix}/auth`, `${apiPrefix}/auth/*`] },
				...(docs.documentation ? { documentation: docs.documentation } : {}),
				...(docs.scalar ? { scalar: docs.scalar } : {}),
				...(docs.swagger ? { swagger: docs.swagger } : {}),
			}),
		);
}
