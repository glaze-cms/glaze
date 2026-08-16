import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';

import { getAuthClient } from '@/lib/auth';

export const Route = createFileRoute('/_authenticated')({
	/**
	 * Gates every nested route on a live session, remembering where the viewer was headed.
	 *
	 * The session is the only check: the server exposes no roles or entitlements, so there is nothing
	 * further to authorize against here.
	 */
	beforeLoad: async ({ location }) => {
		const { data: session } = await getAuthClient().getSession();

		if (!session) {
			throw redirect({
				to: '/login',
				search: { redirect: location.pathname + location.searchStr + location.hash },
			});
		}

		return { session };
	},
	component: Outlet,
});
