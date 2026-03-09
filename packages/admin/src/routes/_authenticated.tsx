import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';

import { getAuthClient } from '@/lib/auth';
import { getConfig } from '@/lib/config';

export const Route = createFileRoute('/_authenticated')({
	beforeLoad: async ({ location }) => {
		const { data: session } = await getAuthClient().getSession();

		if (!session) {
			throw redirect({
				to: '/login',
				search: { redirect: location.href },
			});
		}

		const { apiPrefix } = getConfig();

		const { entitlements } = await fetch(`${apiPrefix}/entitlements`).then(
			(r) => r.json() as Promise<{ entitlements: string[] }>,
		);

		return { session, entitlements };
	},
	component: () => <Outlet />,
});
