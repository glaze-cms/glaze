/**
 * The optional setup token. When `GLAZE_SETUP_TOKEN` is set, the first-admin claim also has to
 * present it, so a server that strangers can reach before anybody has claimed admin is not theirs to
 * take. When unset, nothing is required — the convention Payload and Strapi both follow, right for a
 * server that is still on a developer's machine.
 */

import { timingSafeEqual } from 'node:crypto';

/** The environment variable that holds the token. */
const TOKEN_ENV = 'GLAZE_SETUP_TOKEN';

/** The request header the claim reads the token from. */
export const SETUP_TOKEN_HEADER = 'x-glaze-setup-token';

/**
 * Reads the configured setup token. Trimmed, with blank treated as unset, the way `server/env`
 * reads every other variable.
 *
 * @returns The token, or `null` when none is configured.
 */
export function readSetupToken(): string | null {
	const value = process.env[TOKEN_ENV]?.trim();
	if (!value) return null;
	return value;
}

/**
 * Checks a presented token against the configured one in constant time, so the comparison takes as
 * long for a near miss as for a wild guess. A length mismatch is a plain `false`.
 *
 * @param presented - The token the request carried, or `null` when it carried none.
 * @param expected - The configured token.
 * @returns Whether they match.
 */
export function isSetupTokenValid(presented: string | null, expected: string): boolean {
	if (presented === null) return false;
	const a = Buffer.from(presented);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}
