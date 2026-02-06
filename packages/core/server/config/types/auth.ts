import type { BetterAuthOptions } from 'better-auth';

/**
 * Authentication configuration.
 *
 * By default, public authentication is enabled with email/password.
 * Set `enabled: false` to disable public authentication routes.
 * Admin authentication will always be enabled regardless of this setting.
 *
 * @see https://www.better-auth.com/docs
 */
export type AuthConfig =
	| { enabled: false }
	| {
			enabled?: true;
			emailVerification?: BetterAuthOptions['emailVerification'];
			emailAndPassword?: Omit<
				BetterAuthOptions['emailAndPassword'],
				'enabled'
			> & {
				enabled?: never;
			};
	  };

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
