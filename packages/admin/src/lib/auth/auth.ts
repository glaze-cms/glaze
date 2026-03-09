import { createAuthClient } from 'better-auth/client';
import { getConfig } from '@/lib/config';

type AuthClient = ReturnType<typeof createAuthClient>;

let client: AuthClient | null = null;

export function getAuthClient(): AuthClient {
	if (!client) {
		client = createAuthClient({
			baseURL: `${window.location.origin}${getConfig().apiPrefix}/auth`,
		});
	}
	return client;
}
