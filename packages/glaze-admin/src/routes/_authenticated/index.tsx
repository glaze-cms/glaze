import { createFileRoute } from '@tanstack/react-router';

import { DashboardLayout } from '@/components/layout';
import { useTranslation } from '@/i18n';

/**
 * The landing screen inside the shell. It is intentionally bare: the sections it will link to
 * (collections, records) need a schema/metadata endpoint that the server does not expose yet.
 *
 * @returns The overview page.
 */
function OverviewPage() {
	const { t } = useTranslation();

	return <DashboardLayout Header={<h2>{t.nav.overview}</h2>}>{null}</DashboardLayout>;
}

export const Route = createFileRoute('/_authenticated/')({
	component: OverviewPage,
});
