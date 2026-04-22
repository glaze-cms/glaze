import ReactDOM from 'react-dom/client';

/* TanStack Router */
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from 'gen/tree.ts';

/* i18n */
import TypesafeI18n from '@/i18n/i18n-react';
import { detectLocale } from '@/i18n/i18n-util';
import { loadAllLocales } from '@/i18n/i18n-util.sync';
import {
	localStorageDetector,
	navigatorDetector,
} from 'typesafe-i18n/detectors';

/* Styles */
import '@/lib/styles/app.css';

/* Config */
import { getConfig, loadConfig } from '@/lib/config';

await loadConfig();
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
