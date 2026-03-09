import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';

import { authClient } from '@/lib/auth';
import { getConfig } from '@/lib/config';

export const Route = createFileRoute('/_authenticated')({
	beforeLoad: async ({ location }) => {
		const { data: session } = await authClient.getSession();

		if (!session) {
			throw redirect({
				to: '/login',
				search: { redirect: location.href },
			});
		}

		const { entitlements } = await fetch(
			`${getConfig().apiPrefix}/entitlements`,
		).then((r) => r.json() as Promise<{ entitlements: string[] }>);

		console.log('User session:', session);
		console.log('User entitlements:', entitlements);
		return { session, entitlements };
	},
	component: () => <Outlet />,
});
