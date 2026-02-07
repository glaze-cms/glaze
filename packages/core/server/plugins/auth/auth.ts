import { Elysia } from 'elysia';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import type { AuthConfig, GlazeInternalConfig } from '../../config/types';
import type { GlazeEnv } from '../../validators/env';

import { authResolver } from '../../config/resolver/auth';

/**
 * Creates the Better Auth plugin for Elysia.
 *
 * @param config - The resolved Glaze configuration
 * @param env - The validated environment variables
 * @param db - The Drizzle database instance
 * @param baseURL - The server base URL (e.g., "http://localhost:4000")
 * @returns The Elysia instance with auth routes and decorators
 */
export const authPlugin = (
	config: GlazeInternalConfig,
	env: GlazeEnv,
	db: Parameters<typeof drizzleAdapter>[0],
	baseURL: string,
) => {
	const app = new Elysia({ name: '@glaze/auth' });

	// Resolve auth configuration
	const resolvedAuth = authResolver(
		config.apiPrefix,
		config.auth as AuthConfig,
	);

	// Create Better Auth instance with Drizzle adapter
	const auth = betterAuth({
		appName: resolvedAuth.appName,
		baseURL,
		basePath: resolvedAuth.basePath,
		database: drizzleAdapter(db, {
			provider: 'pg',
			usePlural: true,
		}),
		secret: env.GLAZE_AUTH_SECRET,
		emailAndPassword: resolvedAuth.emailAndPassword,
		emailVerification: resolvedAuth.emailVerification,
		rateLimit: {
			enabled: false,
		},
	});

	return app
		.decorate('auth', auth)
		.mount(auth.handler)
		.derive(async ({ request }) => {
			const session = await auth.api.getSession({
				headers: request.headers,
			});

			return {
				user: session?.user ?? null,
				session: session?.session ?? null,
			};
		});
};
