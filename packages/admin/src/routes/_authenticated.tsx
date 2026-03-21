import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';

import { getAuthClient } from '@/lib/auth';
import { getConfig } from '@/lib/config';

export const Route = createFileRoute('/_authenticated')({
	beforeLoad: async ({ location }) => {
		const { data: session } = await getAuthClient().getSession();

		const returnPath = location.pathname + location.searchStr + location.hash;

		if (!session) {
			throw redirect({
				to: '/login',
				search: { redirect: returnPath },
			});
		}

		const { apiPrefix } = getConfig();

		const entitlementsRes = await fetch(`${apiPrefix}/entitlements`);

		if (entitlementsRes.status === 401) {
			throw redirect({ to: '/login', search: { redirect: returnPath } });
		}

		if (!entitlementsRes.ok) {
			throw new Error(`Failed to load entitlements: ${entitlementsRes.status}`);
		}

		const { entitlements } = (await entitlementsRes.json()) as {
			entitlements: string[];
		};

		return { session, entitlements };
	},
	component: () => <Outlet />,
});
