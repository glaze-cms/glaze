import type { BetterAuthOptions } from 'better-auth';

/**
 * Resolved authentication configuration.
 *
 * @remarks
 * Better Auth always runs for admin authentication.
 * The `publicAuthEnabled` flag controls whether end-user auth routes are exposed.
 */
export type ResolvedAuthConfig = {
	appName: string;
	basePath: string;
	emailAndPassword: BetterAuthOptions['emailAndPassword'];
	emailVerification?: BetterAuthOptions['emailVerification'];
	/** Whether end-user auth routes are exposed */
	publicAuthEnabled: boolean;
};
