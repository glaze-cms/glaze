import { createAuthClient } from 'better-auth/react';

import { getManifest } from '@/lib/config';

type AuthClient = ReturnType<typeof createAuthClient>;

let client: AuthClient | null = null;

/**
 * Returns the Better Auth client, creating it on first use.
 *
 * Construction is deferred rather than done at module load because the base URL depends on the manifest,
 * which is fetched at boot. The React-flavoured client is used so components can read the session
 * reactively via `useSession()` while route guards still call `getSession()` directly.
 *
 * @returns The shared auth client.
 */
export function getAuthClient(): AuthClient {
	client ??= createAuthClient({
		baseURL: `${window.location.origin}${getManifest().apiPrefix}/auth`,
	});
	return client;
}
