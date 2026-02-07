import { Elysia } from 'elysia';
import { betterAuth } from 'better-auth';
import { drizzleAdapter, type DB } from 'better-auth/adapters/drizzle';

import type { AuthConfig, GlazeInternalConfig } from '../../config/types';
import type { GlazeEnv } from '../../validators/env';

import { authResolver } from '../../config/resolver/auth';

/**
 * Creates the Better Auth plugin for Elysia.
 *
 * @param config - The resolved Glaze configuration
 * @param env - The validated environment variables
 * @returns A plugin function that receives the Elysia instance with `db` in decorators
 */
export const authPlugin = (config: GlazeInternalConfig, env: GlazeEnv) =>
	(app: Elysia<
		string,
		{ decorator: { db: DB }; store: {}; derive: {}; resolve: {} }
	>) => {
		const { db } = app.decorator;

		const resolvedAuth = authResolver(
			config.apiPrefix,
			config.auth as AuthConfig,
		);

		const baseURL =
			env.GLAZE_SERVER_URL ?? `http://localhost:${env.GLAZE_PORT}`;

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
