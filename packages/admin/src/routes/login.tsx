import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState, type SubmitEvent, type SubmitEventHandler } from 'react';
import { authClient } from '@/lib/auth';

type LoginSearch = { redirect?: string };

export const Route = createFileRoute('/login')({
	validateSearch: (search: Record<string, unknown>): LoginSearch => ({
		redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
	}),
	beforeLoad: async () => {
		const { data: session } = await authClient.getSession();
		if (session) throw redirect({ to: '/' });
	},
	component: LoginComponent,
});

function LoginComponent() {
	const router = useRouter();
	const { redirect: redirectTo } = Route.useSearch();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		setPending(true);
		setError(null);

		const { error: signInError } = await authClient.signIn.email({
			email,
			password,
		});

		if (signInError) {
			setError(signInError.message ?? 'Invalid credentials');
			setPending(false);
			return;
		}

		await router.navigate({ to: redirectTo ?? '/' });
	}

	return (
		<form onSubmit={handleSubmit as SubmitEventHandler<HTMLFormElement>}>
			<input
				type="email"
				value={email}
				onChange={(e) => {
					setEmail(e.target.value);
				}}
				placeholder="Email"
				required
			/>
			<input
				type="password"
				value={password}
				onChange={(e) => {
					setPassword(e.target.value);
				}}
				placeholder="Password"
				required
			/>
			{error && <p>{error}</p>}
			<button type="submit" disabled={pending}>
				{pending ? 'Signing in…' : 'Sign in'}
			</button>
		</form>
	);
}
