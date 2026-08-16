import { Link, Outlet, createRootRoute } from '@tanstack/react-router';

import { ErrorMessage } from '@/components/error';
import { useTranslation } from '@/i18n';

/**
 * Rendered when a route throws during load or render. Without it, a thrown error leaves a blank page.
 *
 * @param props.error - The thrown error.
 * @returns The error state.
 */
function ErrorState({ error }: { error: Error }) {
	const { t } = useTranslation();

	return (
		<ErrorMessage
			title={t.errors.unexpected.title}
			body={t.errors.unexpected.body}
			detail={error.message}
		/>
	);
}

/**
 * Rendered for unmatched paths.
 *
 * @returns The not-found state.
 */
function NotFoundState() {
	const { t } = useTranslation();

	return (
		<ErrorMessage
			title={t.errors.notFound.title}
			body={t.errors.notFound.body}
			action={<Link to="/">{t.errors.notFound.back}</Link>}
		/>
	);
}

export const Route = createRootRoute({
	component: Outlet,
	errorComponent: ErrorState,
	notFoundComponent: NotFoundState,
});
