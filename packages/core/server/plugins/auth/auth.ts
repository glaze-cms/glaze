import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt } from 'better-auth/plugins';

import {
	authResolver,
	type AuthConfig,
	type GlazeInternalConfig,
	type GlazeEnv,
} from '@glaze/config';

import type { GlazeApp } from '../../types';

/**
 * Creates the Better Auth plugin for Elysia.
 *
 * @param config - The resolved Glaze configuration
 * @param env - The validated environment variables
 * @returns A plugin function that receives the Elysia instance with `db` in decorators
 */
export const authPlugin =
	(config: GlazeInternalConfig, env: GlazeEnv) => (app: GlazeApp) => {
		const { db } = app.decorator;

		const resolvedAuth = authResolver(
			config.apiPrefix,
			config.auth as AuthConfig,
		);

		const baseURL =
			env.GLAZE_SERVER_URL ?? `http://localhost:${env.GLAZE_PORT}`;

		// Deduplicate user-provided plugins, then always append jwt
		const userPlugins = (resolvedAuth.plugins ?? []).filter(
			(p) => p.id !== 'jwt',
		);
		const plugins = [...userPlugins, jwt()];

		// Initialize Better Auth with the resolved configuration and the Drizzle adapter
		const auth = betterAuth({
			appName: resolvedAuth.appName,
			baseURL,
			basePath: resolvedAuth.basePath,
			database: drizzleAdapter(db, {
				provider: 'pg',
				usePlural: true,
				...resolvedAuth.drizzleAdapter,
			}),
			secret: env.GLAZE_AUTH_SECRET,
			emailAndPassword: resolvedAuth.emailAndPassword,
			emailVerification: resolvedAuth.emailVerification,
			plugins,
			rateLimit: {
				enabled: false,
			},
			user: {
				additionalFields: {
					role: {
						type: 'string',
						defaultValue: 'guest',
						required: true,
						input: false,
					},
				},
			},
		});

		// Mount the Better Auth handler and expose the auth instance as a decorator.
		// Session resolution is handled on-demand by the requireRole macro in rbacPlugin.
		return app.decorate('auth', auth).mount(auth.handler);
	};
