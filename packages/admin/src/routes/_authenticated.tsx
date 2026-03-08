import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { authClient } from '@/lib/auth';

export const Route = createFileRoute('/_authenticated')({
	beforeLoad: async ({ location }) => {
		const { data: session } = await authClient.getSession();

		if (!session) {
			throw redirect({
				to: '/login',
				search: { redirect: location.href },
			});
		}

		const { entitlements } = await fetch('/api/entitlements').then(
			(r) => r.json() as Promise<{ entitlements: string[] }>,
		);

		return { session, entitlements };
	},
	component: () => <Outlet />,
});
