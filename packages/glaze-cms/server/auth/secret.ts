/**
 * Resolves the auth signing secret, failing closed in production.
 *
 * The intended UX is that `create-glaze-app` (`bun create glaze`) writes a strong `GLAZE_AUTH_SECRET`
 * into `.env` at scaffold time, so the secret is present from the first run. This guard is
 * **defense-in-depth** for when it isn't: Better Auth falls back to a **publicly-known default secret**
 * when none is provided, and only rejects it when `NODE_ENV` is exactly `"production"` — so a prod
 * deployment that loses the secret (deleted `.env`, `NODE_ENV=staging`/`prod`/unset, …) would sign
 * session cookies with a guessable key, making them forgeable. Glaze enforces its own check: required
 * in production (per Glaze's own {@link isProduction}), with a stable Glaze-specific insecure fallback
 * in dev so nobody ever runs on Better Auth's shared default.
 */

import { isProduction } from '#utils';

import type { Logger } from '#logger';

/** The environment variable holding the auth signing secret (written by `create-glaze-app`). */
const SECRET_ENV = 'GLAZE_AUTH_SECRET';

/**
 * A stable dev-only fallback secret. Insecure by design and never used in production (a missing secret
 * throws there); distinct from Better Auth's shared default so a dev instance can't be forged via that
 * well-known constant.
 */
const DEV_FALLBACK_SECRET = 'glaze-insecure-development-secret-do-not-use-in-production';

/**
 * Resolves the auth signing secret.
 *
 * @param logger - Used to warn when the dev fallback is applied.
 * @returns The configured secret, or the dev fallback outside production.
 * @throws {Error} In production when `GLAZE_AUTH_SECRET` is not set.
 */
export function resolveAuthSecret(logger: Logger): string {
	const secret = process.env[SECRET_ENV];
	if (secret) return secret;

	if (isProduction()) {
		throw new Error(
			`${SECRET_ENV} is required in production: without it, session cookies are signed with a ` +
				`guessable key and can be forged. Set ${SECRET_ENV} to a long random value.`,
		);
	}

	logger.warn(
		`${SECRET_ENV} is not set — using an insecure development secret. Set ${SECRET_ENV} before deploying.`,
	);
	return DEV_FALLBACK_SECRET;
}
