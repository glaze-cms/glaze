import ReactDOM from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from 'gen/tree.ts';
import TypesafeI18n from '@/i18n/i18n-react';

/* Styes */
import '@/lib/styles/app.css';

/* Config */
import { getConfig, loadConfig } from '@/lib/config';
await loadConfig();

/* i18n */
import { detectLocale } from '@/i18n/i18n-util';
import { loadAllLocales } from '@/i18n/i18n-util.sync';
import { localStorageDetector, navigatorDetector } from 'typesafe-i18n/detectors';
loadAllLocales();

const locale = detectLocale(localStorageDetector, navigatorDetector);

const router = createRouter({
	routeTree,
	basepath: getConfig().adminPrefix,
	defaultPreload: 'intent',
	scrollRestoration: true,
});

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}

const rootElement = document.getElementById('root');

if (rootElement && !rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);
	root.render(
		<TypesafeI18n locale={locale}>
			<RouterProvider router={router} />
		</TypesafeI18n>,
	);
}
