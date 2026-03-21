import { createFileRoute } from '@tanstack/react-router';

import { DashboardLayout } from '@/components/layout';

export const Route = createFileRoute('/_authenticated/')({
	component: HomeComponent,
});

function HomeComponent() {
	return <DashboardLayout>{null}</DashboardLayout>;
}
