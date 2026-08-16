import { expect, mock, test } from 'bun:test';

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TranslationProvider, en } from '@/i18n';
import { createQueryClient } from '@/lib/query';

/** Flipped per test, then read by the stubbed auth client below. */
const authState = {
	hasSession: false,
	signInFails: false,
};

// Replaces the Better Auth client for the whole module graph. Stubbing `globalThis.fetch` does not work
// here: better-auth's fetch client resolves its own reference, so the spy never takes effect.
await mock.module('@/lib/auth', () => ({
	getAuthClient: () => ({
		getSession: () =>
			Promise.resolve({ data: authState.hasSession ? { user: {}, session: {} } : null }),
		signIn: {
			email: () =>
				Promise.resolve(
					authState.signInFails
						? { error: { message: 'Invalid email or password' } }
						: { error: null },
				),
		},
		signUp: { email: () => Promise.resolve({ error: null }) },
		signOut: () => Promise.resolve({}),
	}),
	useSignOut: () => () => Promise.resolve(),
}));

const { routeTree } = await import('gen/tree.ts');

/**
 * Mounts the real route tree at a path, wrapped in the providers `main.tsx` supplies.
 *
 * @param path - The initial location.
 * @returns The router, so navigation can be asserted.
 */
function renderAt(path: string) {
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [path] }),
	});

	render(
		<TranslationProvider locale="en" translations={en}>
			<QueryClientProvider client={createQueryClient()}>
				<RouterProvider router={router as never} />
			</QueryClientProvider>
		</TranslationProvider>,
	);

	return router;
}

test('the sign-in screen renders its fields for a signed-out viewer', async () => {
	authState.hasSession = false;
	authState.signInFails = false;

	renderAt('/login');

	await waitFor(() => {
		expect(screen.getByRole('heading', { name: en.auth.signIn.title })).toBeDefined();
	});
	expect(screen.getByLabelText(en.auth.signIn.email)).toBeDefined();
	expect(screen.getByLabelText(en.auth.signIn.password)).toBeDefined();
	expect(screen.getByRole('button', { name: en.auth.signIn.submit })).toBeDefined();
});

test('a rejected sign-in surfaces an alert and leaves the viewer on the screen', async () => {
	authState.hasSession = false;
	authState.signInFails = true;

	renderAt('/login');
	await waitFor(() => {
		expect(screen.getByRole('heading', { name: en.auth.signIn.title })).toBeDefined();
	});

	await userEvent.type(screen.getByLabelText(en.auth.signIn.email), 'someone@example.com');
	await userEvent.type(screen.getByLabelText(en.auth.signIn.password), 'wrong-password');
	await userEvent.click(screen.getByRole('button', { name: en.auth.signIn.submit }));

	await waitFor(() => {
		expect(screen.getByRole('alert').textContent).toContain('Invalid email or password');
	});
	expect(screen.getByRole('heading', { name: en.auth.signIn.title })).toBeDefined();
});

test('an unauthenticated visit to the shell is redirected to sign-in', async () => {
	authState.hasSession = false;
	authState.signInFails = false;

	const router = renderAt('/');

	await waitFor(() => {
		expect(router.state.location.pathname).toBe('/login');
	});
});

test('the shell renders for a signed-in viewer instead of redirecting', async () => {
	authState.hasSession = true;
	authState.signInFails = false;

	const router = renderAt('/');

	await waitFor(() => {
		expect(screen.getByRole('heading', { name: en.nav.overview })).toBeDefined();
	});
	expect(router.state.location.pathname).toBe('/');
});
