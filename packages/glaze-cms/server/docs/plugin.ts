/**
 * The API reference docs: an OpenAPI document generated from the content routes' schemas, rendered by
 * Scalar (default) or Swagger UI via `@elysia/openapi`.
 *
 * Returned for the composer to apply at the ROOT app so it observes every registered route — an openapi
 * instance nested inside another plugin captures none of its siblings' routes. Better Auth's routes are
 * excluded from the spec (they carry no schema). The reference UI loads from a CDN; openapi serves its
 * routes outside the normal request lifecycle, so the global strict CSP is not stamped on them and the CDN
 * is not blocked (self-host alternative tracked in LEA-10).
 */

import { openapi } from '@elysia/openapi';
import { Elysia } from 'elysia';

import type { ResolvedGlazeOptions } from '../options/index.ts';

/**
 * Builds the API-docs plugin.
 *
 * @param docs - The resolved docs config (enabled/path/provider + UI/metadata pass-through).
 * @param apiPrefix - The API mount prefix, used to exclude the auth routes from the spec.
 * @returns The openapi plugin (apply at the root app), or an empty plugin when docs are disabled.
 */
export function createDocsPlugin(docs: ResolvedGlazeOptions['docs'], apiPrefix: string) {
	if (!docs.enabled) return new Elysia({ name: 'glaze.docs' });

	return openapi({
		enabled: true,
		path: docs.path,
		provider: docs.provider === 'swagger' ? 'swagger-ui' : 'scalar',
		// `exclude.paths` matches route paths by EXACT string (Array.includes, not RegExp), so list Better
		// Auth's two registered catch-all paths verbatim.
		exclude: { paths: [`${apiPrefix}/auth`, `${apiPrefix}/auth/*`] },
		...(docs.documentation ? { documentation: docs.documentation } : {}),
		...(docs.scalar ? { scalar: docs.scalar } : {}),
		...(docs.swagger ? { swagger: docs.swagger } : {}),
	});
}
