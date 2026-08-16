/**
 * The base locale, and the source of truth for the translation shape.
 *
 * Deliberately not `as const`: values must widen to `string` so that {@link Translations} describes the
 * *structure* every locale has to provide, not the exact English text.
 */
export const en = {
	app: {
		name: 'Glaze',
	},
	common: {
		cancel: 'Cancel',
		retry: 'Try again',
		loading: 'Loading…',
	},
	nav: {
		overview: 'Overview',
		toggleSidebar: 'Toggle',
		openPanel: 'Open sidebar',
		closePanel: 'Close panel',
		search: 'Search',
		collections: 'Collections',
		noCollections: 'No collections yet',
		newSchema: 'New schema',
		newSchemaUnavailable: 'Schema editing is not available yet',
		signOut: 'Sign out',
	},
	auth: {
		signIn: {
			title: 'Sign in to Glaze',
			subtitle: 'Use the account you created for this project.',
			email: 'Email',
			emailPlaceholder: 'you@example.com',
			password: 'Password',
			passwordPlaceholder: 'Your password',
			submit: 'Sign in',
			submitting: 'Signing in…',
			failed: 'Invalid email or password.',
			noAccount: 'No account yet?',
			createOne: 'Create one',
		},
		signUp: {
			title: 'Create your Glaze account',
			subtitle: 'The first account you create is your admin account.',
			name: 'Name',
			namePlaceholder: 'Ada Lovelace',
			submit: 'Create account',
			submitting: 'Creating account…',
			failed: 'Could not create the account.',
			haveAccount: 'Already have an account?',
			signIn: 'Sign in',
		},
	},
	errors: {
		bootstrap: {
			title: 'Glaze could not start',
			body: 'The admin could not reach the Glaze server. Check that it is running, then try again.',
		},
		notFound: {
			title: 'Page not found',
			body: 'That page does not exist.',
			back: 'Back to Glaze',
		},
		unexpected: {
			title: 'Something went wrong',
			body: 'An unexpected error occurred while rendering this page.',
		},
	},
};
