import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';

import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/button';
import { Input } from '@/components/input';
import { useTranslation } from '@/i18n';
import { getAuthClient } from '@/lib/auth';

import type { FormEvent } from 'react';

/** Where to return after a successful sign-in, captured by the route guard. */
interface LoginSearch {
	redirect?: string;
}

/**
 * The sign-in screen.
 *
 * @returns The sign-in form.
 */
function LoginPage() {
	const router = useRouter();
	const { t } = useTranslation();
	const { redirect: redirectTo } = Route.useSearch();

	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [isPending, setIsPending] = useState(false);

	async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		setIsPending(true);
		setError(null);

		const { error: signInError } = await getAuthClient().signIn.email({ email, password });

		if (signInError) {
			setError(signInError.message ?? t.auth.signIn.failed);
			setIsPending(false);
			return;
		}

		await router.navigate({ to: redirectTo ?? '/' });
	}

	return (
		<AuthShell
			title={t.auth.signIn.title}
			subtitle={t.auth.signIn.subtitle}
			footer={
				<>
					{t.auth.signIn.noAccount} <Link to="/signup">{t.auth.signIn.createOne}</Link>
				</>
			}
		>
			<form
				className="auth-form"
				onSubmit={(event) => {
					void handleSubmit(event);
				}}
			>
				<div className="auth-field">
					<label htmlFor="email">{t.auth.signIn.email}</label>
					<Input
						id="email"
						type="email"
						autoComplete="email"
						value={email}
						placeholder={t.auth.signIn.emailPlaceholder}
						onChange={(event) => {
							setEmail(event.target.value);
						}}
						required
					/>
				</div>

				<div className="auth-field">
					<label htmlFor="password">{t.auth.signIn.password}</label>
					<Input
						id="password"
						type="password"
						autoComplete="current-password"
						value={password}
						placeholder={t.auth.signIn.passwordPlaceholder}
						onChange={(event) => {
							setPassword(event.target.value);
						}}
						required
					/>
				</div>

				{error && (
					<p className="auth-error" role="alert">
						{error}
					</p>
				)}

				<Button type="submit" variant="primary" disabled={isPending}>
					{isPending ? t.auth.signIn.submitting : t.auth.signIn.submit}
				</Button>
			</form>
		</AuthShell>
	);
}

export const Route = createFileRoute('/login')({
	validateSearch: (search: Record<string, unknown>): LoginSearch =>
		typeof search['redirect'] === 'string' ? { redirect: search['redirect'] } : {},
	beforeLoad: async () => {
		const { data: session } = await getAuthClient().getSession();
		if (session) throw redirect({ to: '/' });
	},
	component: LoginPage,
});
