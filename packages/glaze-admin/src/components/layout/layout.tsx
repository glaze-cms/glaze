import { Sidebar } from './components/sidebar';

import type { HTMLAttributes, ReactNode } from 'react';

import './layout.css';

interface LayoutProps extends HTMLAttributes<HTMLDivElement> {
	children: ReactNode;
	Header?: ReactNode;
}

/**
 * The authenticated shell: sidebar, an optional page header, and the page body.
 *
 * @param props.Header - Rendered in the header bar. The bar is omitted entirely when absent.
 * @param props.children - The page body.
 * @returns The dashboard frame.
 */
export function DashboardLayout({ Header, children, ...props }: LayoutProps) {
	return (
		<div className="dashboard" {...props}>
			<Sidebar />
			<main className="main">
				{Header && <header className="header">{Header}</header>}
				<div className="content">{children}</div>
			</main>
		</div>
	);
}
