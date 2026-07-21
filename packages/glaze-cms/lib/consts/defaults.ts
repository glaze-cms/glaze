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

/** Default HTTP port the server listens on when none is configured or found in the environment. */
export const DEFAULT_PORT = 4000;

/** The locked-secure Content-Security-Policy baseline; user directives merge on top (extend, not replace). */
export const DEFAULT_CSP: Readonly<Record<string, string>> = {
	'default-src': "'self'",
	'base-uri': "'self'",
	'frame-ancestors': "'none'",
	'object-src': "'none'",
};
