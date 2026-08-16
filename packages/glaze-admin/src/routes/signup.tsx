import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';

import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/button';
import { Input } from '@/components/input';
import { useTranslation } from '@/i18n';
import { getAuthClient } from '@/lib/auth';

import type { FormEvent } from 'react';

/**
 * The sign-up screen.
 *
 * Sign-up is currently open on the server — anyone who can reach the admin can create an account. Gating
 * it once the first account exists is tracked separately; until then this screen is how a fresh install
 * gets its admin user.
 *
 * @returns The sign-up form.
 */
function SignUpPage() {
	const router = useRouter();
	const { t } = useTranslation();

	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [isPending, setIsPending] = useState(false);

	async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		setIsPending(true);
		setError(null);

		const { error: signUpError } = await getAuthClient().signUp.email({ name, email, password });

		if (signUpError) {
			setError(signUpError.message ?? t.auth.signUp.failed);
			setIsPending(false);
			return;
		}

		await router.navigate({ to: '/' });
	}

	return (
		<AuthShell
			title={t.auth.signUp.title}
			subtitle={t.auth.signUp.subtitle}
			footer={
				<>
					{t.auth.signUp.haveAccount} <Link to="/login">{t.auth.signUp.signIn}</Link>
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
					<label htmlFor="name">{t.auth.signUp.name}</label>
					<Input
						id="name"
						autoComplete="name"
						value={name}
						placeholder={t.auth.signUp.namePlaceholder}
						onChange={(event) => {
							setName(event.target.value);
						}}
						required
					/>
				</div>

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
						autoComplete="new-password"
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
					{isPending ? t.auth.signUp.submitting : t.auth.signUp.submit}
				</Button>
			</form>
		</AuthShell>
	);
}

export const Route = createFileRoute('/signup')({
	beforeLoad: async () => {
		const { data: session } = await getAuthClient().getSession();
		if (session) throw redirect({ to: '/' });
	},
	component: SignUpPage,
});
