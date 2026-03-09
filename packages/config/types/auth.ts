import type { BetterAuthOptions } from 'better-auth';

/**
 * Configuration for the BetterAuth Drizzle adapter.
 */
export type DrizzleAdapterConfig = {
	/** Enable debug logging for the Drizzle adapter */
	debugLogs?: boolean;
};

/**
 * Allowed BetterAuth options that users can configure.
 * Restricted options (database, appName, baseUrl, basePath, secret, etc.)
 * are managed internally by Glaze and cannot be overridden.
 */
export type Auth = {
	/** Email verification configuration */
	emailVerification?: BetterAuthOptions['emailVerification'];
	/** Email and password authentication configuration - enabled is always true */
	emailAndPassword?: Omit<
		NonNullable<BetterAuthOptions['emailAndPassword']>,
		'enabled'
	>;
	/** Session configuration */
	session?: BetterAuthOptions['session'];
	/** Additional Better Auth plugins */
	plugins?: BetterAuthOptions['plugins'];
};

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
			/** User-configurable BetterAuth options (restricted fields managed by Glaze) */
			betterAuth?: Auth;
			/** Drizzle adapter configuration */
			drizzleAdapter?: DrizzleAdapterConfig;
			emailVerification?: BetterAuthOptions['emailVerification'];
			emailAndPassword?: Omit<
				NonNullable<BetterAuthOptions['emailAndPassword']>,
				'enabled'
			> & {
				enabled?: never;
			};
			/** Session configuration */
			session?: BetterAuthOptions['session'];
			/** Additional Better Auth plugins */
			plugins?: BetterAuthOptions['plugins'];
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
	/** Drizzle adapter configuration */
	drizzleAdapter?: DrizzleAdapterConfig;
	/** Session configuration */
	session?: BetterAuthOptions['session'];
	/** User-provided Better Auth plugins */
	plugins?: BetterAuthOptions['plugins'];
	/** Whether end-user auth routes are exposed */
	publicAuthEnabled: boolean;
};
