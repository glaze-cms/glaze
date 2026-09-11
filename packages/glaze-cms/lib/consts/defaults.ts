/**
 * Glaze's default constant values, shared package-wide. Constant *values* live here; shared *functions*
 * live in `lib/utils`, global *types* in `lib/types`.
 */

/** Default admin app mount prefix. */
export const DEFAULT_ADMIN_PREFIX = '/admin';

/** Default content/API mount prefix. */
export const DEFAULT_API_PREFIX = '/api';

/** Default health route path. */
export const DEFAULT_HEALTH_PATH = '/_health';

/** Default mount path for the API reference docs (Scalar/Swagger). */
export const DEFAULT_DOCS_PATH = '/openapi';

/** Default HTTP port the server listens on when none is configured or found in the environment. */
export const DEFAULT_PORT = 4000;

/** Minimum length Glaze requires of `GLAZE_AUTH_SECRET`; a shorter secret is too weak to sign sessions. */
export const MIN_AUTH_SECRET_LENGTH = 32;

/** Minimum length Glaze requires of `GLAZE_SETUP_TOKEN` when one is set; shorter is guessable. */
export const MIN_SETUP_TOKEN_LENGTH = 16;

/** The locked-secure Content-Security-Policy baseline; user directives merge on top (extend, not replace). */
export const DEFAULT_CSP: Readonly<Record<string, string>> = {
	'default-src': "'self'",
	'base-uri': "'self'",
	'frame-ancestors': "'none'",
	'object-src': "'none'",
	// form-action does NOT fall back to default-src, so set it explicitly.
	'form-action': "'self'",
};
