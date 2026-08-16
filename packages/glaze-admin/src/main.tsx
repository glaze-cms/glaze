import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from 'gen/tree.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { BootstrapError } from '@/components/error';
import { TranslationProvider, detectLocale, loadTranslations } from '@/i18n';
import { getManifest, loadManifest } from '@/lib/config';
import { createQueryClient } from '@/lib/query';
import '@/lib/styles/app.css';

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof createAppRouter>;
	}
}

/**
 * Builds the router. The base path comes from the server manifest, because the admin prefix is
 * configurable and the bundle cannot know it at build time.
 *
 * @returns The configured router.
 */
function createAppRouter() {
	return createRouter({
		routeTree,
		basepath: getManifest().adminPrefix,
		defaultPreload: 'intent',
		scrollRestoration: true,
	});
}

/**
 * Loads everything the tree needs before the first render: the server manifest and the active locale.
 *
 * Both are awaited up front so no component has to handle a half-initialized app, and any failure is
 * rendered as a real error instead of leaving a blank page.
 *
 * @param container - The mount node.
 */
async function start(container: HTMLElement): Promise<void> {
	const root = createRoot(container);

	const locale = detectLocale();
	const translations = await loadTranslations(locale);

	try {
		await loadManifest();
	} catch (error) {
		root.render(
			<StrictMode>
				<TranslationProvider locale={locale} translations={translations}>
					<BootstrapError error={error instanceof Error ? error : new Error(String(error))} />
				</TranslationProvider>
			</StrictMode>,
		);
		return;
	}

	const router = createAppRouter();
	const queryClient = createQueryClient();

	root.render(
		<StrictMode>
			<TranslationProvider locale={locale} translations={translations}>
				<QueryClientProvider client={queryClient}>
					<RouterProvider router={router} />
				</QueryClientProvider>
			</TranslationProvider>
		</StrictMode>,
	);
}

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');

void start(container);
