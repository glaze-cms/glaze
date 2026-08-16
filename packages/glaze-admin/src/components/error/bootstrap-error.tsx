import { Button } from '@/components/button';
import { useTranslation } from '@/i18n';

import { ErrorMessage } from './message.tsx';

/**
 * Shown when the admin cannot reach the Glaze server at boot.
 *
 * This renders outside the router — the router's own error boundary cannot help, because the router is
 * not constructed until the manifest resolves.
 *
 * @param props.error - What went wrong while loading the manifest.
 * @returns The bootstrap failure state.
 */
export function BootstrapError({ error }: { error: Error }) {
	const { t } = useTranslation();

	return (
		<ErrorMessage
			title={t.errors.bootstrap.title}
			body={t.errors.bootstrap.body}
			detail={error.message}
			action={
				<Button
					variant="outlined"
					fullWidth={false}
					onClick={() => {
						globalThis.location.reload();
					}}
				>
					{t.common.retry}
				</Button>
			}
		/>
	);
}
