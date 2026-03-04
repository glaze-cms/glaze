import { Elysia, status } from 'elysia';

import {
	ENTITLEMENTS,
	hasMinRole,
	type GlazeInternalConfig,
	type Role,
} from '@glaze/config';

type AuthDecorator = {
	api: {
		getSession(opts: { headers: Headers }): Promise<{
			user: { role: string };
			session: unknown;
		} | null>;
	};
};

/**
 * RBAC plugin for Glaze.
 *
 * Defines the `requireRole` macro and exposes the entitlements endpoint.
 * Must be registered after `authPlugin` (needs the `auth` decorator).
 * @config - The Glaze internal configuration object
 * @return An Elysia plugin instance that provides RBAC functionality
 */
export const rbacPlugin = (config: GlazeInternalConfig) =>
	new Elysia({ name: '@glaze/rbac' })
		.macro({
			requireRole(minRole: Role) {
				return {
					async resolve(ctx) {
						const { request } = ctx;
						const { auth } = ctx as typeof ctx & { auth: AuthDecorator };

						const session = await auth.api.getSession({
							headers: request.headers,
						});

						if (!session) return status(401);
						if (!hasMinRole(session.user.role as Role, minRole))
							return status(403);

						return { user: session.user, session: session.session };
					},
				};
			},
		})
		.get(
			`${config.apiPrefix}/entitlements`,
			(ctx) => {
				const user = (ctx as unknown as { user: { role: string } }).user;
				const entitlements = ENTITLEMENTS[user.role as Role];
				return { entitlements: [...entitlements] };
			},
			{ requireRole: 'guest' },
		);
