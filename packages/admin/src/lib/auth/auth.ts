import { createAuthClient } from 'better-auth/client';
import { getConfig } from '@/lib/config';

export const authClient = createAuthClient({
	baseURL: `${window.location.origin}${getConfig().apiPrefix}/auth`,
});
