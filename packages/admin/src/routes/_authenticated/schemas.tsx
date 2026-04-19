import { createFileRoute } from '@tanstack/react-router';

/* Components */
import { DashboardLayout } from '@/components/layout';
import { NoContent } from '@/components/layout/components/no-content';

/* i18n */
import { useI18nContext } from '@/i18n/i18n-react';

export const Route = createFileRoute('/_authenticated/schemas')({
	component: SchemasComponent,
});

function SchemasComponent() {
	const { LL } = useI18nContext();

	return (
		<DashboardLayout>
			<NoContent title={LL.schemas['no-content'].title()} withBorder>
				<p>{LL.schemas['no-content'].body()}</p>
			</NoContent>
		</DashboardLayout>
	);
}
